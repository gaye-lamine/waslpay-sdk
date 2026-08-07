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

final class MtnMomoProvider implements PaymentProviderInterface
{
    private const SANDBOX_URL = 'https://sandbox.momodeveloper.mtn.com';
    private const PRODUCTION_URL = 'https://proxy.momoapi.mtn.com';

    private ?string $accessToken = null;
    private int $accessTokenExpiresAt = 0;
    private readonly WebhookEventStoreInterface $webhookEventStore;

    public function __construct(
        private readonly ClientInterface $httpClient,
        private readonly string $subscriptionKey,
        private readonly string $apiUser,
        private readonly string $apiKey,
        private readonly string $targetEnvironment = 'sandbox',
        private readonly string $defaultCurrency = 'XOF',
        ?WebhookEventStoreInterface $webhookEventStore = null,
        private readonly ?string $baseUrlOverride = null,
    ) {
        // A PHP worker-local store is safe for development only; production must
        // inject a durable store shared by webhook handling workers.
        $this->webhookEventStore = $webhookEventStore ?? new InMemoryWebhookEventStore();
    }

    public function initiatePayment(PaymentRequest $params): PaymentSession
    {
        if ($params->customerPhone === null || $params->customerPhone === '') {
            throw new ProviderException(PaymentError::InvalidPhone, 'MTN MoMo requires a customer phone number');
        }
        $sessionId = $this->uuid();
        $this->request('POST', '/collection/v1_0/requesttopay', [
            'amount' => (string) $params->amount,
            'currency' => $params->currency ?: $this->defaultCurrency,
            'externalId' => $params->reference,
            'payer' => ['partyIdType' => 'MSISDN', 'partyId' => $params->customerPhone],
            'payerMessage' => 'Payment request',
            'payeeNote' => $params->reference,
        ], $sessionId);
        return new PaymentSession($sessionId, $params->reference, $params->amount, $params->currency ?: $this->defaultCurrency, PaymentStatus::Pending);
    }

    public function checkStatus(string $sessionId): PaymentStatusResult
    {
        $payload = $this->transaction($sessionId);
        $status = $this->status((string) ($payload['status'] ?? ''));

        return new PaymentStatusResult(
            $status,
            $status === PaymentStatus::Failed
                ? $this->errorFor(200, (string) ($payload['code'] ?? ''))
                : null,
        );
    }

    public function handleWebhook(string $rawBody, array $headers): PaymentEvent
    {
        $key = $this->header($headers, 'ocp-apim-subscription-key');
        if ($key === null || !hash_equals($this->subscriptionKey, $key)) {
            throw new ProviderException(PaymentError::Unknown, 'Invalid MTN MoMo webhook security key');
        }
        $payload = $this->decode($rawBody);
        $sessionId = $payload['referenceId'] ?? null;
        $status = $payload['status'] ?? null;
        if (!is_string($sessionId) || !is_string($status)) {
            throw new ProviderException(PaymentError::Unknown, 'Incomplete MTN MoMo webhook payload');
        }
        $paymentStatus = $this->status($status);
        $error = $paymentStatus === PaymentStatus::Failed
            ? $this->errorFor(200, (string) ($payload['code'] ?? ''))
            : null;
        $event = new PaymentEvent((string) ($payload['id'] ?? $sessionId), $sessionId, $paymentStatus, (string) ($payload['timestamp'] ?? gmdate(DATE_ATOM)), isset($payload['externalId']) ? (string) $payload['externalId'] : null, $error);

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

        $transaction = $this->transaction($sessionId);
        $originalAmount = $this->originalAmount($transaction['amount'] ?? null);

        if ($amount !== null && $amount > $originalAmount) {
            throw new ProviderException(
                PaymentError::RefundAmountExceedsBalance,
                'Refund amount exceeds the original payment amount',
            );
        }

        $refundAmount = $amount ?? $originalAmount;
        $refundId = $this->uuid();
        $this->request('POST', '/collection/v1_0/refund', [
            'amount' => (string) $refundAmount,
            'currency' => $this->defaultCurrency,
            'externalId' => $sessionId,
            'payerMessage' => 'Refund',
            'payeeNote' => 'Refund',
        ], $refundId);
        return new RefundResult($sessionId, $refundId, $refundAmount, PaymentStatus::Pending);
    }

    private function transaction(string $sessionId): array
    {
        return $this->json($this->request('GET', '/collection/v1_0/requesttopay/' . rawurlencode($sessionId)));
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

        throw new ProviderException(PaymentError::Unknown, 'MTN MoMo response is missing original amount');
    }

    private function processWebhookEvent(PaymentEvent $event): PaymentEvent
    {
        return $event;
    }

    private function request(string $method, string $path, ?array $body = null, ?string $referenceId = null): ResponseInterface
    {
        $factory = new HttpFactory();
        $request = $factory->createRequest($method, $this->baseUrl() . $path)
            ->withHeader('Authorization', 'Bearer ' . $this->token())
            ->withHeader('X-Target-Environment', $this->targetEnvironment)
            ->withHeader('Ocp-Apim-Subscription-Key', $this->subscriptionKey)
            ->withHeader('Content-Type', 'application/json');
        if ($referenceId !== null) { $request = $request->withHeader('X-Reference-Id', $referenceId); }
        if ($body !== null) { $request = $request->withBody($factory->createStream(json_encode($body, JSON_THROW_ON_ERROR))); }
        return $this->send($request);
    }

    private function token(): string
    {
        if ($this->accessToken !== null && time() < $this->accessTokenExpiresAt) { return $this->accessToken; }
        $factory = new HttpFactory();
        $request = $factory->createRequest('POST', $this->baseUrl() . '/collection/token/')
            ->withHeader('Authorization', 'Basic ' . base64_encode($this->apiUser . ':' . $this->apiKey))
            ->withHeader('Ocp-Apim-Subscription-Key', $this->subscriptionKey);
        $payload = $this->json($this->send($request));
        $token = $payload['access_token'] ?? null;
        if (!is_string($token) || $token === '') { throw new ProviderException(PaymentError::Unknown, 'Invalid MTN MoMo token response'); }
        $this->accessToken = $token;
        $this->accessTokenExpiresAt = time() + max(0, ((int) ($payload['expires_in'] ?? 300)) - 30);
        return $token;
    }

    private function send($request): ResponseInterface
    {
        try { $response = $this->httpClient->sendRequest($request); } catch (ClientExceptionInterface $exception) { throw new ProviderException(PaymentError::ProviderTimeout, $exception->getMessage()); }
        if ($response->getStatusCode() >= 400) {
            $payload = $this->json($response);
            $code = (string) ($payload['code'] ?? '');
            $error = $this->errorFor($response->getStatusCode(), $code);
            throw new ProviderException($error, (string) ($payload['message'] ?? 'MTN MoMo request failed'));
        }
        return $response;
    }

    private function status(string $status): PaymentStatus { return match (strtoupper($status)) { 'SUCCESSFUL' => PaymentStatus::Success, 'PENDING' => PaymentStatus::Pending, 'FAILED' => PaymentStatus::Failed, default => throw new ProviderException(PaymentError::Unknown, 'Unknown MTN MoMo status') }; }
    private function errorFor(int $httpStatus, string $code): PaymentError
    {
        if (in_array($code, ['RESOURCE_NOT_FOUND', 'PAYER_NOT_FOUND', 'NOT_ENOUGH_FUNDS'], true)) {
            return PaymentError::InsufficientFunds;
        }
        if (in_array($code, ['APPROVAL_REJECTED', 'EXPIRED'], true)) {
            return PaymentError::UserCancelled;
        }
        if ($httpStatus >= 500 || $httpStatus === 408 || $httpStatus === 429) {
            return PaymentError::ProviderTimeout;
        }

        return PaymentError::Unknown;
    }
    private function json(ResponseInterface $response): array { return $this->decode((string) $response->getBody()); }
    private function decode(string $body): array { $payload = json_decode($body, true, 512, JSON_THROW_ON_ERROR); if (!is_array($payload)) { throw new ProviderException(PaymentError::Unknown, 'Invalid MTN MoMo JSON response'); } return $payload; }
    private function header(array $headers, string $name): ?string
    {
        foreach ($headers as $key => $value) {
            if (strtolower((string) $key) === $name) {
                if (is_string($value)) {
                    return $value;
                }
                if (is_array($value) && isset($value[0]) && is_string($value[0])) {
                    return $value[0];
                }
            }
        }
        return null;
    }
    private function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);

        return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20));
    }
    private function baseUrl(): string
    {
        return rtrim($this->baseUrlOverride ?? ($this->targetEnvironment === 'production' ? self::PRODUCTION_URL : self::SANDBOX_URL), '/');
    }
}
