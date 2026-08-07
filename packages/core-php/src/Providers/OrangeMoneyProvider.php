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
use Psr\Http\Client\ClientExceptionInterface;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\ResponseInterface;

final class OrangeMoneyProvider implements PaymentProviderInterface
{
    private const SANDBOX_URL = 'https://api.sandbox.orange-sonatel.com';
    private const LIVE_URL = 'https://api.orange-sonatel.com';

    private ?string $accessToken = null;
    private int $accessTokenExpiresAt = 0;
    private readonly WebhookEventStoreInterface $webhookEventStore;

    public function __construct(
        private readonly ClientInterface $httpClient,
        private readonly string $clientId,
        private readonly string $clientSecret,
        private readonly string $merchantCode,
        private readonly string $sitename,
        private readonly string $callbackUrl,
        private readonly string $webhookApiKey,
        private readonly string $environment = 'sandbox',
        ?WebhookEventStoreInterface $webhookEventStore = null,
        private readonly ?string $baseUrlOverride = null,
    ) {
        // A process-global default would not persist reliably across PHP requests.
        // Production integrations should inject a durable shared store explicitly.
        $this->webhookEventStore = $webhookEventStore ?? new InMemoryWebhookEventStore();
    }

    public function initiatePayment(PaymentRequest $params): PaymentSession
    {
        $body = [
            'merchantCode' => $this->merchantCode,
            'sitename' => $this->sitename,
            'amount' => $params->amount,
            'reference' => $params->reference,
            'urls' => [
                'cancelUrl' => $params->failureUrl ?? $this->callbackUrl,
                'successUrl' => $params->successUrl ?? $this->callbackUrl,
                'callbackUrl' => $this->callbackUrl,
            ],
        ];
        $payload = $this->json($this->request('POST', '/v1/onlinePayment/prepare', $body));
        $paymentUrl = $payload['paymentUrl'] ?? null;
        if (!is_string($paymentUrl) || $paymentUrl === '') {
            throw new ProviderException(PaymentError::Unknown, 'Orange Money response is missing paymentUrl');
        }

        return new PaymentSession($params->reference, $params->reference, $params->amount, $params->currency, PaymentStatus::Pending, $paymentUrl);
    }

    public function checkStatus(string $sessionId): PaymentStatusResult
    {
        $query = http_build_query(['reference' => $sessionId, 'type' => 'WEB_PAYMENT']);
        $payload = $this->json($this->request('GET', '/api/eWallet/v1/transactions?' . $query));
        $transaction = is_array($payload['transactions'] ?? null) ? $payload['transactions'][0] ?? null : null;
        $status = is_array($transaction) ? $transaction['status'] ?? null : null;
        if (!is_string($status)) {
            throw new ProviderException(PaymentError::Unknown, 'Orange Money transaction was not found');
        }

        $paymentStatus = $this->status($status);

        return new PaymentStatusResult(
            $paymentStatus,
            $paymentStatus === PaymentStatus::Failed
                ? $this->errorForCode((string) ($transaction['code'] ?? ''))
                : null,
        );
    }

    public function handleWebhook(string $rawBody, array $headers): PaymentEvent
    {
        $apiKey = $this->header($headers, 'x-api-key');
        if ($apiKey === null || !hash_equals($this->webhookApiKey, $apiKey)) {
            throw new ProviderException(PaymentError::Unknown, 'Invalid Orange Money webhook API key');
        }
        $payload = $this->decode($rawBody);
        $sessionId = $payload['reference'] ?? $payload['transactionId'] ?? null;
        $status = $payload['status'] ?? null;
        if (!is_string($sessionId) || !is_string($status)) {
            throw new ProviderException(PaymentError::Unknown, 'Incomplete Orange Money webhook payload');
        }

        $paymentStatus = $this->status($status);
        $error = $paymentStatus === PaymentStatus::Failed
            ? $this->errorForCode((string) ($payload['code'] ?? ''))
            : null;

        $event = new PaymentEvent((string) ($payload['id'] ?? $payload['transactionId'] ?? $sessionId), $sessionId, $paymentStatus, (string) ($payload['timestamp'] ?? gmdate(DATE_ATOM)), isset($payload['reference']) ? (string) $payload['reference'] : null, $error);

        return $this->webhookEventStore->process($event, fn (PaymentEvent $event): PaymentEvent => $this->processWebhookEvent($event));
    }

    public function refund(string $sessionId, int|float|null $amount = null): RefundResult
    {
        throw new ProviderException(PaymentError::Unknown, 'Orange Money does not support self-service merchant refunds');
    }

    private function request(string $method, string $path, ?array $body = null): ResponseInterface
    {
        $factory = new HttpFactory();
        $request = $factory->createRequest($method, $this->baseUrl() . $path)
            ->withHeader('Authorization', 'Bearer ' . $this->token())
            ->withHeader('Content-Type', 'application/json');
        if ($body !== null) {
            $request = $request->withBody($factory->createStream(json_encode($body, JSON_THROW_ON_ERROR)));
        }
        return $this->send($request);
    }

    private function processWebhookEvent(PaymentEvent $event): PaymentEvent
    {
        return $event;
    }

    private function token(): string
    {
        if ($this->accessToken !== null && time() < $this->accessTokenExpiresAt) {
            return $this->accessToken;
        }
        $factory = new HttpFactory();
        $request = $factory->createRequest('POST', $this->baseUrl() . '/oauth/v1/token')
            ->withHeader('Authorization', 'Basic ' . base64_encode($this->clientId . ':' . $this->clientSecret))
            ->withHeader('Content-Type', 'application/x-www-form-urlencoded')
            ->withBody($factory->createStream('grant_type=client_credentials'));
        $payload = $this->json($this->send($request));
        $token = $payload['access_token'] ?? null;
        if (!is_string($token) || $token === '') {
            throw new ProviderException(PaymentError::Unknown, 'Invalid Orange Money token response');
        }
        $this->accessToken = $token;
        $this->accessTokenExpiresAt = time() + max(0, ((int) ($payload['expires_in'] ?? 300)) - 30);
        return $token;
    }

    private function send($request): ResponseInterface
    {
        try {
            $response = $this->httpClient->sendRequest($request);
        } catch (ClientExceptionInterface $exception) {
            throw new ProviderException(PaymentError::ProviderTimeout, $exception->getMessage());
        }
        if ($response->getStatusCode() >= 400) {
            $payload = $this->json($response);
            $code = (string) ($payload['code'] ?? $response->getStatusCode());
            $error = $this->errorForCode($code);
            throw new ProviderException($error, (string) ($payload['message'] ?? 'Orange Money request failed'));
        }
        return $response;
    }

    private function json(ResponseInterface $response): array
    {
        return $this->decode((string) $response->getBody());
    }

    private function decode(string $body): array
    {
        $payload = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($payload)) {
            throw new ProviderException(PaymentError::Unknown, 'Invalid Orange Money JSON response');
        }
        return $payload;
    }

    private function status(string $status): PaymentStatus
    {
        return match (strtoupper($status)) {
            'ACCEPTED', 'SUCCESS' => PaymentStatus::Success,
            'PENDING', 'INITIATED' => PaymentStatus::Pending,
            'CANCELLED', 'REJECTED', 'FAILED' => PaymentStatus::Failed,
            default => throw new ProviderException(PaymentError::Unknown, 'Unknown Orange Money status'),
        };
    }

    private function errorForCode(string $code): PaymentError
    {
        return match ($code) {
            '2020', '2021' => PaymentError::InsufficientFunds,
            '2000', '2001' => PaymentError::InvalidPhone,
            '500', '50', '51', '1', '2', '5' => PaymentError::ProviderTimeout,
            default => PaymentError::Unknown,
        };
    }

    private function header(array $headers, string $name): ?string
    {
        foreach ($headers as $headerName => $value) {
            if (strtolower((string) $headerName) === $name) {
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

    private function baseUrl(): string
    {
        if ($this->baseUrlOverride !== null) {
            return rtrim($this->baseUrlOverride, '/');
        }
        return $this->environment === 'live' ? self::LIVE_URL : self::SANDBOX_URL;
    }
}
