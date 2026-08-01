<?php

declare(strict_types=1);

namespace WaslPay\Sdk\Providers;

use GuzzleHttp\Psr7\HttpFactory;
use WaslPay\Sdk\Contracts\PaymentProviderInterface;
use WaslPay\Sdk\Contracts\WebhookEventStoreInterface;
use WaslPay\Sdk\DTO\PaymentEvent;
use WaslPay\Sdk\DTO\PaymentRequest;
use WaslPay\Sdk\DTO\PaymentSession;
use WaslPay\Sdk\DTO\PaymentStatusResult;
use WaslPay\Sdk\DTO\RefundResult;
use WaslPay\Sdk\Enums\PaymentError;
use WaslPay\Sdk\Enums\PaymentStatus;
use WaslPay\Sdk\Exceptions\ProviderException;
use WaslPay\Sdk\Support\InMemoryWebhookEventStore;
use WaslPay\Sdk\Support\RefundAmountValidator;
use Psr\Http\Client\ClientExceptionInterface;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * @phpstan-type WaveCheckoutSession array{
 *   id?: string,
 *   amount?: int|string,
 *   client_reference?: string|null,
 *   wave_launch_url?: string,
 *   checkout_status?: 'open'|'complete'|'expired',
 *   payment_status?: string,
 *   error_code?: string,
 *   when_expires?: string,
 *   when_completed?: string,
 *   when_created?: string
 * }
 */
final class WaveProvider implements PaymentProviderInterface
{
    private const BASE_URL = 'https://api.wave.com/v1';
    private readonly WebhookEventStoreInterface $webhookEventStore;

    public function __construct(private readonly ClientInterface $httpClient, private readonly string $apiKey, private readonly string $webhookSecret, ?WebhookEventStoreInterface $webhookEventStore = null, private readonly ?string $baseUrlOverride = null)
    {
        // A process-global default would share mutable state across unrelated workers.
        // Inject a durable shared store when deduplication must survive requests.
        $this->webhookEventStore = $webhookEventStore ?? new InMemoryWebhookEventStore();
    }

    public function initiatePayment(PaymentRequest $params): PaymentSession
    {
        $payload = $this->json($this->request('POST', '/checkout/sessions', [
            'amount' => $params->amount,
            'currency' => 'XOF',
            'error_url' => $params->failureUrl,
            'success_url' => $params->successUrl,
            'client_reference' => $params->reference,
        ]));
        $id = $payload['id'] ?? null;
        if (!is_string($id) || $id === '') {
            throw new ProviderException(PaymentError::Unknown, 'Wave checkout response is missing id');
        }
        return new PaymentSession($id, $params->reference, $params->amount, $params->currency, PaymentStatus::Pending, isset($payload['wave_launch_url']) ? (string) $payload['wave_launch_url'] : null);
    }

    public function checkStatus(string $sessionId): PaymentStatusResult
    {
        $payload = $this->checkoutSession($sessionId);
        // checkout_status takes priority because payment_status has no documented expired value.
        if (($payload['checkout_status'] ?? null) === 'expired') {
            return new PaymentStatusResult(PaymentStatus::Expired);
        }
        $status = $this->status((string) ($payload['payment_status'] ?? ''));

        return new PaymentStatusResult(
            $status,
            $status === PaymentStatus::Failed
                ? $this->errorFor(200, (string) ($payload['error_code'] ?? ''))
                : null,
        );
    }

    public function handleWebhook(string $rawBody, array $headers): PaymentEvent
    {
        $signature = $this->header($headers, 'x-wave-signature');
        if ($signature === null || !$this->validSignature($rawBody, $signature)) {
            throw new ProviderException(PaymentError::Unknown, 'Invalid Wave webhook signature');
        }
        $payload = $this->decode($rawBody);
        $data = is_array($payload['data'] ?? null) ? $payload['data'] : [];
        $sessionId = $data['id'] ?? null;
        if (!is_string($sessionId) || $sessionId === '') {
            throw new ProviderException(PaymentError::Unknown, 'Incomplete Wave webhook payload');
        }
        $eventType = (string) ($payload['type'] ?? '');
        // Wave currently documents no dedicated webhook event type for expiration.
        // An expired checkout_status is therefore accepted before event-type mapping.
        $status = ($data['checkout_status'] ?? null) === 'expired'
            ? PaymentStatus::Expired
            : ($eventType === 'checkout.session.completed'
                ? PaymentStatus::Success
                : ($eventType === 'checkout.session.payment_failed'
                    ? PaymentStatus::Failed
                    : $this->status((string) ($data['payment_status'] ?? ''))));
        $error = $status === PaymentStatus::Failed
            ? $this->errorFor(200, (string) ($data['error_code'] ?? ''))
            : null;
        $event = new PaymentEvent((string) ($payload['id'] ?? $sessionId), $sessionId, $status, (string) ($data['when_completed'] ?? $data['when_expires'] ?? $data['when_created'] ?? gmdate(DATE_ATOM)), isset($data['client_reference']) ? (string) $data['client_reference'] : null, $error);

        return $this->webhookEventStore->process($event, fn (PaymentEvent $event): PaymentEvent => $this->processWebhookEvent($event));
    }

    public function refund(string $sessionId, int|float|null $amount = null): RefundResult
    {
        if ($amount !== null) {
            $amount = RefundAmountValidator::validate(
                $amount,
                fn (PaymentError $code, string $message): ProviderException => new ProviderException($code, $message),
            );
        }

        $session = $this->checkoutSession($sessionId);
        $originalAmount = $this->originalAmount($session['amount'] ?? null);

        if ($amount !== null && $amount > $originalAmount) {
            throw new ProviderException(
                PaymentError::RefundAmountExceedsBalance,
                'Refund amount exceeds the original payment amount',
            );
        }

        $refundAmount = $amount ?? $originalAmount;
        $payload = $this->json($this->request('POST', '/checkout/sessions/' . rawurlencode($sessionId) . '/refund', $amount === null ? null : ['amount' => $refundAmount]));
        $refundId = $payload['id'] ?? null;
        $refundAmount = $payload['amount'] ?? null;
        if (!is_string($refundId) || !is_int($refundAmount)) {
            throw new ProviderException(PaymentError::Unknown, 'Incomplete Wave refund response');
        }
        return new RefundResult($sessionId, $refundId, $refundAmount, isset($payload['status']) ? $this->status((string) $payload['status']) : PaymentStatus::Success);
    }

    private function request(string $method, string $path, ?array $body = null): ResponseInterface
    {
        $factory = new HttpFactory();
        $request = $factory->createRequest($method, $this->baseUrl() . $path)
            ->withHeader('Authorization', 'Bearer ' . $this->apiKey)
            ->withHeader('Content-Type', 'application/json');
        if ($body !== null) {
            $request = $request->withBody($factory->createStream(json_encode($body, JSON_THROW_ON_ERROR)));
        }
        try {
            $response = $this->httpClient->sendRequest($request);
        } catch (ClientExceptionInterface $exception) {
            throw new ProviderException(PaymentError::ProviderTimeout, $exception->getMessage());
        }
        if ($response->getStatusCode() >= 400) {
            $payload = $this->json($response);
            $code = (string) ($payload['error_code'] ?? $payload['code'] ?? '');
            $error = $this->errorFor($response->getStatusCode(), $code);
            throw new ProviderException($error, (string) ($payload['error_message'] ?? $payload['message'] ?? 'Wave request failed'));
        }
        return $response;
    }

    private function baseUrl(): string
    {
        return rtrim($this->baseUrlOverride ?? self::BASE_URL, '/');
    }

    /** @return WaveCheckoutSession */
    private function checkoutSession(string $sessionId): array
    {
        return $this->json($this->request('GET', '/checkout/sessions/' . rawurlencode($sessionId)));
    }

    private function originalAmount(mixed $amount): int
    {
        if (is_int($amount) && $amount > 0) {
            return $amount;
        }

        if (is_string($amount) && ctype_digit($amount)) {
            $parsed = (int) $amount;
            if ($parsed > 0 && (string) $parsed === $amount) {
                return $parsed;
            }
        }

        throw new ProviderException(PaymentError::Unknown, 'Wave checkout response is missing a valid amount');
    }

    private function processWebhookEvent(PaymentEvent $event): PaymentEvent
    {
        return $event;
    }

    private function validSignature(string $rawBody, string $signature): bool
    {
        $expected = hash_hmac('sha256', $rawBody, $this->webhookSecret);
        foreach (explode(',', $signature) as $candidate) {
            $candidate = preg_replace('/^v1=/', '', trim($candidate)) ?? '';
            if (hash_equals($expected, $candidate)) {
                return true;
            }
        }
        return false;
    }

    private function status(string $status): PaymentStatus
    {
        return match (strtolower($status)) {
            'succeeded', 'success' => PaymentStatus::Success,
            'processing', 'pending' => PaymentStatus::Pending,
            'cancelled', 'failed' => PaymentStatus::Failed,
            default => throw new ProviderException(PaymentError::Unknown, 'Unknown Wave payment status'),
        };
    }

    private function errorFor(int $httpStatus, string $code): PaymentError
    {
        if ($code === 'insufficient-funds') {
            return PaymentError::InsufficientFunds;
        }
        if ($code === 'payer-mobile-mismatch' || $code === 'invalid-phone') {
            return PaymentError::InvalidPhone;
        }
        if ($code === 'payment-cancelled' || $code === 'user-cancelled') {
            return PaymentError::UserCancelled;
        }
        if ($httpStatus >= 500 || $httpStatus === 408 || $httpStatus === 429) {
            return PaymentError::ProviderTimeout;
        }

        return PaymentError::Unknown;
    }

    private function json(ResponseInterface $response): array { return $this->decode((string) $response->getBody()); }
    private function decode(string $body): array { $payload = json_decode($body, true, 512, JSON_THROW_ON_ERROR); if (!is_array($payload)) { throw new ProviderException(PaymentError::Unknown, 'Invalid Wave JSON response'); } return $payload; }
    private function header(array $headers, string $name): ?string { foreach ($headers as $key => $value) { if (strtolower($key) === $name && is_string($value)) { return $value; } } return null; }
}
