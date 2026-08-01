import { afterEach, vi } from "vitest";

import { MtnMomoProvider } from "../../src/providers/mtn-momo.js";
import { PaymentError, PaymentStatus } from "../../src/types.js";
import type { WebhookEventStore } from "../../src/webhook-event-store.js";
import { runProviderContractTests, type ProviderContractFixture } from "../contract/provider.contract.js";

const SUBSCRIPTION_KEY = "mtn-contract-subscription-key";

function createProvider(webhookEventStore?: WebhookEventStore): MtnMomoProvider {
  return new MtnMomoProvider({
    subscriptionKey: SUBSCRIPTION_KEY,
    apiUser: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    apiKey: "mtn-contract-api-key",
    targetEnvironment: "sandbox",
    defaultCurrency: "XOF",
    ...(webhookEventStore === undefined ? {} : { webhookEventStore }),
  });
}

function installHttpMock(): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/collection/token/")) return Response.json({ access_token: "mtn-contract-token", expires_in: 3_600 });
    if (url.endsWith("/collection/v1_0/requesttopay") && init?.method === "POST") return new Response(null, { status: 202 });
    if (url.endsWith("/collection/v1_0/refund") && init?.method === "POST") return new Response(null, { status: 202 });
    if (url.includes("/collection/v1_0/requesttopay/")) {
      const sessionId = url.substring(url.lastIndexOf("/") + 1);
      if (sessionId === "mtn-session-timeout") return Response.json({}, { status: 503 });
      return Response.json({
        amount: sessionId === "mtn-session-unusual" ? Number.MAX_SAFE_INTEGER.toString() : "1000",
        status: sessionId === "mtn-session-failed" ? "FAILED" : "SUCCESSFUL",
        ...(sessionId === "mtn-session-failed" ? { code: "NOT_ENOUGH_FUNDS" } : {}),
      });
    }
    return Response.json({}, { status: 404 });
  }));
}

const validWebhookBody = JSON.stringify({
  referenceId: "mtn-session-success", externalId: "contract-success", status: "SUCCESSFUL", timestamp: "2026-07-21T12:00:00.000Z",
});

const fixture: ProviderContractFixture = {
  createProvider,
  installHttpMock,
  paymentRequest: { amount: 1_000, currency: "XOF", reference: "contract-success", customerPhone: "+221770000000" },
  failedSessionId: "mtn-session-failed",
  failedPaymentError: PaymentError.InsufficientFunds,
  timeoutSessionId: "mtn-session-timeout",
  validWebhook: {
    rawBody: validWebhookBody,
    headers: { "Ocp-Apim-Subscription-Key": SUBSCRIPTION_KEY },
    expectedEvent: {
      id: "mtn-session-success", sessionId: "mtn-session-success", reference: "contract-success",
      status: PaymentStatus.Success, occurredAt: "2026-07-21T12:00:00.000Z",
    },
  },
  failedWebhook: {
    rawBody: JSON.stringify({
      id: "mtn-session-failed", referenceId: "mtn-session-failed", externalId: "contract-failed", status: "FAILED", code: "NOT_ENOUGH_FUNDS", timestamp: "2026-07-21T12:00:00.000Z",
    }),
    headers: { "Ocp-Apim-Subscription-Key": SUBSCRIPTION_KEY },
    expectedEvent: {
      id: "mtn-session-failed", sessionId: "mtn-session-failed", reference: "contract-failed",
      status: PaymentStatus.Failed, occurredAt: "2026-07-21T12:00:00.000Z", error: PaymentError.InsufficientFunds,
    },
  },
  invalidWebhook: { rawBody: '{"status":"SUCCESSFUL"}', headers: { "ocp-apim-subscription-key": "invalid-key" } },
  refund: { sessionId: "mtn-session-success", originalAmount: 1_000, unusualOriginalSessionId: "mtn-session-unusual", unusualOriginalAmount: Number.MAX_SAFE_INTEGER, partialAmount: 500, fullAmount: 1_000, supported: true, status: PaymentStatus.Pending },
  expiration: { sessionId: "mtn-session-expired-unsupported", supported: false },
};

afterEach(() => vi.unstubAllGlobals());
runProviderContractTests("MTN MoMo", fixture);
