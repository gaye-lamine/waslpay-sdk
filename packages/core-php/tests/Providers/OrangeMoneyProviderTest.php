<?php

declare(strict_types=1);

namespace WaslPay\Sdk\Tests\Providers;

use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use WaslPay\Sdk\Contracts\PaymentProviderInterface;
use WaslPay\Sdk\Contracts\WebhookEventStoreInterface;
use WaslPay\Sdk\DTO\PaymentRequest;
use WaslPay\Sdk\Enums\PaymentStatus;
use WaslPay\Sdk\Enums\PaymentError;
use WaslPay\Sdk\Providers\OrangeMoneyProvider;
use WaslPay\Sdk\Tests\Contract\AbstractProviderContract;

final class OrangeMoneyProviderTest extends AbstractProviderContract
{
    protected function createProvider(?WebhookEventStoreInterface $webhookEventStore = null): PaymentProviderInterface
    {
        $responses = match ($this->name()) {
            'testInitiatePaymentAndCheckStatusSuccess' => [$this->token(), $this->json(['paymentUrl' => 'https://orange.test/pay']), $this->json(['transactions' => [['status' => 'SUCCESS']]])],
            'testPaymentFailedMappedToPaymentError' => [
                $this->token(),
                $this->json(['transactions' => [['status' => 'FAILED', 'code' => 2020]]]),
            ],
            'testProviderTimeoutMappedCorrectly' => [$this->token(), $this->json(['code' => 500], 503)],
            default => [],
        };
        return new OrangeMoneyProvider($this->client($responses), 'id', 'secret', 'merchant', 'site', 'https://merchant.test/callback', 'orange-key', 'sandbox', $webhookEventStore);
    }

    protected function contractFixture(): array
    {
        return [
            'request' => new PaymentRequest(1000, 'XOF', 'contract-success'),
            'failedSessionId' => 'contract-failed', 'failedPaymentError' => PaymentError::InsufficientFunds, 'timeoutSessionId' => 'contract-timeout',
            'validWebhook' => ['rawBody' => '{"transactionId":"orange-1","reference":"contract-success","status":"SUCCESS"}', 'headers' => ['x-api-key' => 'orange-key'], 'id' => 'orange-1', 'sessionId' => 'contract-success', 'status' => PaymentStatus::Success],
            'failedWebhook' => ['rawBody' => '{"transactionId":"orange-failed","reference":"contract-failed","status":"FAILED","code":"2020"}', 'headers' => ['x-api-key' => 'orange-key'], 'id' => 'orange-failed', 'sessionId' => 'contract-failed', 'status' => PaymentStatus::Failed],
            'invalidWebhook' => ['rawBody' => '{}', 'headers' => ['x-api-key' => 'invalid']],
            'refund' => ['sessionId' => 'contract-success', 'originalAmount' => 1000, 'unusualOriginalSessionId' => 'contract-unusual', 'unusualOriginalAmount' => PHP_INT_MAX, 'partialAmount' => 500, 'fullAmount' => 1000, 'supported' => false, 'status' => PaymentStatus::Failed],
            'expiration' => ['sessionId' => 'orange-expired-unsupported', 'supported' => false],
        ];
    }

    /** @param list<Response> $responses */
    private function client(array $responses): Client { return new Client(['handler' => HandlerStack::create(new MockHandler($responses))]); }
    private function token(): Response { return $this->json(['access_token' => 'token', 'expires_in' => 3600]); }
    private function json(array $body, int $status = 200): Response { return new Response($status, ['Content-Type' => 'application/json'], json_encode($body, JSON_THROW_ON_ERROR)); }
}
