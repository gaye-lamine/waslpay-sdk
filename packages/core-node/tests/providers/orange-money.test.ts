import { afterEach, expect, vi } from "vitest";

import { OrangeMoneyProvider } from "../../src/providers/orange-money.js";
import { PaymentError, PaymentStatus } from "../../src/types.js";
import type { WebhookEventStore } from "../../src/webhook-event-store.js";
import { runProviderContractTests, type ProviderContractFixture } from "../contract/provider.contract.js";

const WEBHOOK_API_KEY = "orange-contract-webhook-key";

function createProvider(webhookEventStore?: WebhookEventStore): OrangeMoneyProvider {
  return new OrangeMoneyProvider({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    merchantCode: "test-merchant",
    sitename: "WaslPay contract tests",
    environment: "sandbox",
    callbackUrl: "https://merchant.example.test/orange/callback",
    webhookApiKey: WEBHOOK_API_KEY,
    ...(webhookEventStore === undefined ? {} : { webhookEventStore }),
  });
}

function installHttpMock(): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/oauth/v1/token")) return Response.json({ access_token: "test-access-token", expires_in: 3_600 });
    if (url.endsWith("/v1/onlinePayment/prepare")) return Response.json({ paymentUrl: "https://payment.orange.test/pay/contract-success" });
    if (url.includes("/api/eWallet/v1/transactions?")) {
      const reference = new URL(url).searchParams.get("reference");
      if (reference === "contract-timeout") return Response.json({ code: 500 }, { status: 504 });
      return Response.json({
        transactions: [{
          status: reference === "contract-failed" ? "FAILED" : "SUCCESS",
          ...(reference === "contract-failed" ? { code: 2020 } : {}),
        }],
      });
    }
    return Response.json({ code: 9999 }, { status: 404 });
  }));
}

const validWebhookBody = JSON.stringify({
  transactionId: "orange-transaction-1",
  reference: "contract-success",
  status: "SUCCESS",
  timestamp: "2026-07-21T12:00:00.000Z",
});

const fixture: ProviderContractFixture = {
  createProvider,
  installHttpMock,
  paymentRequest: { amount: 1_000, currency: "XOF", reference: "contract-success" },
  failedSessionId: "contract-failed",
  failedPaymentError: PaymentError.InsufficientFunds,
  timeoutSessionId: "contract-timeout",
  validWebhook: {
    rawBody: validWebhookBody,
    headers: { "X-Api-Key": WEBHOOK_API_KEY },
    expectedEvent: {
      id: "orange-transaction-1", sessionId: "contract-success", reference: "contract-success",
      status: PaymentStatus.Success, occurredAt: "2026-07-21T12:00:00.000Z",
    },
  },
  failedWebhook: {
    rawBody: JSON.stringify({
      id: "orange-transaction-failed", reference: "contract-failed", status: "FAILED", code: "2020", timestamp: "2026-07-21T12:00:00.000Z",
    }),
    headers: { "X-Api-Key": WEBHOOK_API_KEY },
    expectedEvent: {
      id: "orange-transaction-failed", sessionId: "contract-failed", reference: "contract-failed",
      status: PaymentStatus.Failed, occurredAt: "2026-07-21T12:00:00.000Z", error: PaymentError.InsufficientFunds,
    },
  },
  invalidWebhook: { rawBody: '{"reference":"contract-success","status":"SUCCESS"}', headers: { "x-api-key": "invalid-key" } },
  refund: { sessionId: "contract-success", originalAmount: 1_000, unusualOriginalSessionId: "contract-unusual", unusualOriginalAmount: Number.MAX_SAFE_INTEGER, partialAmount: 500, fullAmount: 1_000, supported: false },
  expiration: { sessionId: "orange-session-expired-unsupported", supported: false },
};

afterEach(() => vi.unstubAllGlobals());
runProviderContractTests("Orange Money", fixture);
