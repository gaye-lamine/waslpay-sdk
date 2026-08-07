<?php

declare(strict_types=1);

namespace WaslPay\Sdk\Tests\Contract;

use WaslPay\Sdk\Contracts\PaymentProviderInterface;
use WaslPay\Sdk\Contracts\WebhookEventStoreInterface;
use WaslPay\Sdk\DTO\PaymentRequest;
use WaslPay\Sdk\Enums\PaymentError;
use WaslPay\Sdk\Enums\PaymentStatus;
use WaslPay\Sdk\Exceptions\ProviderException;
use PHPUnit\Framework\TestCase;

abstract class AbstractProviderContract extends TestCase
{
    abstract protected function createProvider(?WebhookEventStoreInterface $webhookEventStore = null): PaymentProviderInterface;

    /** @return array{request: PaymentRequest, failedSessionId: string, failedPaymentError: PaymentError, timeoutSessionId: string, validWebhook: array{rawBody: string, headers: array<string, string>, id: string, sessionId: string, status: PaymentStatus}, invalidWebhook: array{rawBody: string, headers: array<string, string>}, apiError?: array{sessionId: string, expectedError: PaymentError}, refund: array{sessionId: string, originalAmount: int, unusualOriginalSessionId: string, unusualOriginalAmount: int, partialAmount: int, fullAmount: int, supported: bool, status: PaymentStatus}, expiration: array{sessionId: string, supported: bool, webhook?: array{rawBody: string, headers: array<string, string>, id: string, sessionId: string, status: PaymentStatus, occurredAt: string}}} */
    abstract protected function contractFixture(): array;

    public function testInitiatePaymentAndCheckStatusSuccess(): void
    {
        $provider = $this->createProvider();
        $request = $this->contractFixture()['request'];

        $session = $provider->initiatePayment($request);

        self::assertNotSame('', $session->id);
        self::assertSame($request->reference, $session->reference);
        self::assertSame($request->amount, $session->amount);
        self::assertSame($request->currency, $session->currency);
        self::assertSame(PaymentStatus::Success, $provider->checkStatus($session->id)->status);
    }

    public function testPaymentFailedMappedToPaymentError(): void
    {
        $fixture = $this->contractFixture();
        $result = $this->createProvider()->checkStatus($fixture['failedSessionId']);

        self::assertSame(PaymentStatus::Failed, $result->status);
        self::assertSame($fixture['failedPaymentError'], $result->error);
    }

    public function testValidWebhookReturnsPaymentEvent(): void
    {
        $fixture = $this->contractFixture()['validWebhook'];
        $event = $this->createProvider()->handleWebhook($fixture['rawBody'], $fixture['headers']);

        self::assertSame($fixture['id'], $event->id);
        self::assertSame($fixture['sessionId'], $event->sessionId);
        self::assertSame($fixture['status'], $event->status);
        self::assertNotSame('', $event->occurredAt);
    }

    public function testValidWebhookWithSymfonyArrayHeaders(): void
    {
        $fixture = $this->contractFixture()['validWebhook'];
        $symfonyHeaders = array_map(
            fn ($value) => is_array($value) ? $value : [$value],
            $fixture['headers']
        );
        $event = $this->createProvider()->handleWebhook($fixture['rawBody'], $symfonyHeaders);

        self::assertSame($fixture['id'], $event->id);
        self::assertSame($fixture['sessionId'], $event->sessionId);
        self::assertSame($fixture['status'], $event->status);
    }

    public function testFailedWebhookReturnsPaymentEventWithError(): void
    {
        $fixture = $this->contractFixture()['failedWebhook'] ?? null;
        if ($fixture === null) {
            $this->markTestSkipped('Provider has no failed webhook fixture.');
        }

        $event = $this->createProvider()->handleWebhook($fixture['rawBody'], $fixture['headers']);

        self::assertSame(PaymentStatus::Failed, $event->status);
        self::assertNotNull($event->error);
    }

    public function testInvalidWebhookSignatureThrowsException(): void
    {
        $fixture = $this->contractFixture()['invalidWebhook'];
        $this->expectException(\Throwable::class);
        $this->createProvider()->handleWebhook($fixture['rawBody'], $fixture['headers']);
    }

    public function testApiErrorCodeFieldMapped(): void
    {
        $apiError = $this->contractFixture()['apiError'] ?? null;
        if ($apiError === null) {
            $this->markTestSkipped('Provider has no API error code fixture.');
        }

        try {
            $this->createProvider()->checkStatus($apiError['sessionId']);
            self::fail('Expected an API error response to be rejected.');
        } catch (ProviderException $exception) {
            self::assertSame($apiError['expectedError'], $exception->paymentError);
        }
    }

    public function testPartialRefund(): void
    {
        $fixture = $this->contractFixture()['refund'];
        if (!$fixture['supported']) {
            $this->expectException(\Throwable::class);
            $this->createProvider()->refund($fixture['sessionId'], $fixture['partialAmount']);
            return;
        }
        $refund = $this->createProvider()->refund($fixture['sessionId'], $fixture['partialAmount']);

        self::assertSame($fixture['sessionId'], $refund->sessionId);
        self::assertSame($fixture['partialAmount'], $refund->amount);
        self::assertSame($fixture['status'], $refund->status);
    }

    public function testFullRefund(): void
    {
        $fixture = $this->contractFixture()['refund'];
        if (!$fixture['supported']) {
            $this->expectException(\Throwable::class);
            $this->createProvider()->refund($fixture['sessionId']);
            return;
        }
        $refund = $this->createProvider()->refund($fixture['sessionId']);

        self::assertSame($fixture['sessionId'], $refund->sessionId);
        self::assertSame($fixture['fullAmount'], $refund->amount);
        self::assertSame($fixture['status'], $refund->status);
    }

    public function testZeroRefundAmountIsRejected(): void
    {
        $this->assertInvalidRefundAmount(0);
    }

    public function testNegativeRefundAmountIsRejected(): void
    {
        $this->assertInvalidRefundAmount(-1);
    }

    public function testDecimalRefundAmountIsRejected(): void
    {
        $this->assertInvalidRefundAmount(1.5);
    }

    public function testRefundAmountExceedingOriginalIsRejected(): void
    {
        $fixture = $this->contractFixture()['refund'];
        if (!$fixture['supported']) {
            $this->markTestSkipped('Provider does not support refunds.');
        }

        try {
            $this->createProvider()->refund($fixture['sessionId'], $fixture['originalAmount'] + 1);
            self::fail('Expected a refund amount exceeding the original amount to be rejected.');
        } catch (ProviderException $exception) {
            self::assertSame(PaymentError::RefundAmountExceedsBalance, $exception->paymentError);
        }
    }

    public function testTotalRefundIsExemptFromAmountLimit(): void
    {
        $fixture = $this->contractFixture()['refund'];
        if (!$fixture['supported']) {
            $this->markTestSkipped('Provider does not support refunds.');
        }

        $refund = $this->createProvider()->refund($fixture['unusualOriginalSessionId']);

        self::assertSame($fixture['unusualOriginalSessionId'], $refund->sessionId);
        self::assertSame($fixture['unusualOriginalAmount'], $refund->amount);
        self::assertSame($fixture['status'], $refund->status);
    }

    public function testExpiredSession(): void
    {
        $fixture = $this->contractFixture()['expiration'];
        if (!$fixture['supported']) {
            $this->markTestSkipped('Provider does not support expired sessions.');
        }

        self::assertSame(PaymentStatus::Expired, $this->createProvider()->checkStatus($fixture['sessionId'])->status);

        if (!isset($fixture['webhook'])) {
            return;
        }

        $webhook = $fixture['webhook'];
        $event = $this->createProvider()->handleWebhook($webhook['rawBody'], $webhook['headers']);
        self::assertSame($webhook['id'], $event->id);
        self::assertSame($webhook['sessionId'], $event->sessionId);
        self::assertSame(PaymentStatus::Expired, $event->status);
        self::assertSame($webhook['occurredAt'], $event->occurredAt);
    }

    public function testProviderTimeoutMappedCorrectly(): void
    {
        $this->expectException(\Throwable::class);
        $this->createProvider()->checkStatus($this->contractFixture()['timeoutSessionId']);
    }

    public function testWebhookDeliveredTwice(): void
    {
        $fixture = $this->contractFixture()['validWebhook'];
        $store = new SpyWebhookEventStore();
        $provider = $this->createProvider($store);
        $first = $provider->handleWebhook($fixture['rawBody'], $fixture['headers']);
        $second = $provider->handleWebhook($fixture['rawBody'], $fixture['headers']);

        self::assertEquals($first, $second);
        self::assertSame($first->id, $second->id);
        self::assertSame(1, $store->businessProcessCalls);
    }

    private function assertInvalidRefundAmount(int|float $amount): void
    {
        $fixture = $this->contractFixture()['refund'];
        if (!$fixture['supported']) {
            $this->markTestSkipped('Provider does not support refunds.');
        }

        try {
            $this->createProvider()->refund($fixture['sessionId'], $amount);
            self::fail('Expected an invalid refund amount to be rejected.');
        } catch (ProviderException $exception) {
            self::assertSame(PaymentError::InvalidRefundAmount, $exception->paymentError);
        }
    }
}
