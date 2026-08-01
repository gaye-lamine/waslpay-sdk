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
use WaslPay\Sdk\Providers\WaveProvider;
use WaslPay\Sdk\Tests\Contract\AbstractProviderContract;

final class WaveProviderTest extends AbstractProviderContract
{
    private const SECRET = 'wave-secret';

    protected function createProvider(?WebhookEventStoreInterface $webhookEventStore = null): PaymentProviderInterface
    {
        $responses = match ($this->name()) {
            'testInitiatePaymentAndCheckStatusSuccess' => [$this->json(['id' => 'wave-1', 'wave_launch_url' => 'https://wave.test/pay']), $this->json(['payment_status' => 'succeeded'])],
            'testPaymentFailedMappedToPaymentError' => [$this->json(['payment_status' => 'cancelled', 'error_code' => 'insufficient-funds'])],
            'testApiErrorCodeFieldMapped' => [$this->json(['code' => 'insufficient-funds', 'message' => 'Wave code field error'], 400)],
            'testPartialRefund' => [$this->json(['amount' => 1000]), $this->json(['id' => 'refund-1', 'amount' => 500, 'status' => 'succeeded'])],
            'testFullRefund' => [$this->json(['amount' => 1000]), $this->json(['id' => 'refund-2', 'amount' => 1000, 'status' => 'succeeded'])],
            'testRefundAmountExceedingOriginalIsRejected' => [$this->json(['amount' => 1000])],
            'testTotalRefundIsExemptFromAmountLimit' => [$this->json(['amount' => PHP_INT_MAX]), $this->json(['id' => 'refund-max', 'amount' => PHP_INT_MAX, 'status' => 'succeeded'])],
            'testExpiredSession' => [$this->json(['checkout_status' => 'expired', 'payment_status' => 'processing', 'when_expires' => '2026-07-22T12:00:00+00:00'])],
            'testProviderTimeoutMappedCorrectly' => [$this->json([], 503)],
            default => [],
        };
        return new WaveProvider($this->client($responses), 'wave_sn_test_key', self::SECRET, $webhookEventStore);
    }

    protected function contractFixture(): array
    {
        $rawBody = '{"id":"event-1","type":"checkout.session.completed","data":{"id":"wave-1","client_reference":"contract-success","payment_status":"succeeded"}}';
        $expiredWebhook = '{"id":"event-expired","type":"checkout.session.updated","data":{"id":"wave-expired","client_reference":"contract-expired","checkout_status":"expired","payment_status":"processing","when_expires":"2026-07-22T12:00:00+00:00"}}';
        $failedWebhook = '{"id":"event-failed","type":"checkout.session.payment_failed","data":{"id":"wave-failed","client_reference":"contract-failed","payment_status":"cancelled"}}';
        return [
            'request' => new PaymentRequest(1000, 'XOF', 'contract-success'),
            'failedSessionId' => 'contract-failed', 'failedPaymentError' => PaymentError::InsufficientFunds, 'timeoutSessionId' => 'contract-timeout',
            'validWebhook' => ['rawBody' => $rawBody, 'headers' => ['x-wave-signature' => hash_hmac('sha256', $rawBody, self::SECRET)], 'id' => 'event-1', 'sessionId' => 'wave-1', 'status' => PaymentStatus::Success],
            'failedWebhook' => ['rawBody' => $failedWebhook, 'headers' => ['x-wave-signature' => hash_hmac('sha256', $failedWebhook, self::SECRET)], 'id' => 'event-failed', 'sessionId' => 'wave-failed', 'status' => PaymentStatus::Failed],
            'invalidWebhook' => ['rawBody' => '{}', 'headers' => ['x-wave-signature' => 'invalid']],
            'apiError' => ['sessionId' => 'wave-api-error', 'expectedError' => PaymentError::InsufficientFunds],
            'refund' => ['sessionId' => 'contract-success', 'originalAmount' => 1000, 'unusualOriginalSessionId' => 'wave-unusual', 'unusualOriginalAmount' => PHP_INT_MAX, 'partialAmount' => 500, 'fullAmount' => 1000, 'supported' => true, 'status' => PaymentStatus::Success],
            'expiration' => ['sessionId' => 'wave-expired', 'supported' => true, 'webhook' => ['rawBody' => $expiredWebhook, 'headers' => ['x-wave-signature' => hash_hmac('sha256', $expiredWebhook, self::SECRET)], 'id' => 'event-expired', 'sessionId' => 'wave-expired', 'status' => PaymentStatus::Expired, 'occurredAt' => '2026-07-22T12:00:00+00:00']],
        ];
    }

    /** @param list<Response> $responses */
    private function client(array $responses): Client { return new Client(['handler' => HandlerStack::create(new MockHandler($responses))]); }
    private function json(array $body, int $status = 200): Response { return new Response($status, ['Content-Type' => 'application/json'], json_encode($body, JSON_THROW_ON_ERROR)); }
}
