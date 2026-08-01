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
use WaslPay\Sdk\Providers\MtnMomoProvider;
use WaslPay\Sdk\Tests\Contract\AbstractProviderContract;

final class MtnMomoProviderTest extends AbstractProviderContract
{
    protected function createProvider(?WebhookEventStoreInterface $webhookEventStore = null): PaymentProviderInterface
    {
        $responses = match ($this->name()) {
            'testPaymentFailedMappedToPaymentError' => [$this->token(), $this->json(['status' => 'FAILED', 'code' => 'NOT_ENOUGH_FUNDS'])],
            'testPartialRefund' => [$this->token(), $this->json(['amount' => 1000]), new Response(202)],
            'testFullRefund' => [$this->token(), $this->json(['amount' => 1000]), new Response(202)],
            'testRefundAmountExceedingOriginalIsRejected' => [$this->token(), $this->json(['amount' => 1000])],
            'testTotalRefundIsExemptFromAmountLimit' => [$this->token(), $this->json(['amount' => PHP_INT_MAX]), new Response(202)],
            'testProviderTimeoutMappedCorrectly' => [$this->token(), $this->json([], 503)],
            default => [$this->token(), new Response(202), $this->json(['status' => 'SUCCESSFUL'])],
        };
        return new MtnMomoProvider($this->client($responses), 'mtn-key', '3fa85f64-5717-4562-b3fc-2c963f66afa6', 'api-key', 'sandbox', 'XOF', $webhookEventStore);
    }

    protected function contractFixture(): array
    {
        return [
            'request' => new PaymentRequest(1000, 'XOF', 'contract-success', '+221770000000'),
            'failedSessionId' => 'contract-failed', 'failedPaymentError' => PaymentError::InsufficientFunds, 'timeoutSessionId' => 'contract-timeout',
            'validWebhook' => ['rawBody' => '{"referenceId":"mtn-1","externalId":"contract-success","status":"SUCCESSFUL"}', 'headers' => ['ocp-apim-subscription-key' => 'mtn-key'], 'id' => 'mtn-1', 'sessionId' => 'mtn-1', 'status' => PaymentStatus::Success],
            'failedWebhook' => ['rawBody' => '{"referenceId":"mtn-failed","externalId":"contract-failed","status":"FAILED","code":"NOT_ENOUGH_FUNDS"}', 'headers' => ['ocp-apim-subscription-key' => 'mtn-key'], 'id' => 'mtn-failed', 'sessionId' => 'mtn-failed', 'status' => PaymentStatus::Failed],
            'invalidWebhook' => ['rawBody' => '{}', 'headers' => ['ocp-apim-subscription-key' => 'invalid']],
            'refund' => ['sessionId' => 'contract-success', 'originalAmount' => 1000, 'unusualOriginalSessionId' => 'mtn-unusual', 'unusualOriginalAmount' => PHP_INT_MAX, 'partialAmount' => 500, 'fullAmount' => 1000, 'supported' => true, 'status' => PaymentStatus::Pending],
            'expiration' => ['sessionId' => 'mtn-expired-unsupported', 'supported' => false],
        ];
    }

    /** @param list<Response> $responses */
    private function client(array $responses): Client { return new Client(['handler' => HandlerStack::create(new MockHandler($responses))]); }
    private function token(): Response { return $this->json(['access_token' => 'token', 'expires_in' => 3600]); }
    private function json(array $body, int $status = 200): Response { return new Response($status, ['Content-Type' => 'application/json'], json_encode($body, JSON_THROW_ON_ERROR)); }
}
