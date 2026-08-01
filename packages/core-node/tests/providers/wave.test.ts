import { createHmac } from "node:crypto";

import { afterEach, vi } from "vitest";

import { WaveProvider } from "../../src/providers/wave.js";
import { PaymentError, PaymentStatus } from "../../src/types.js";
import type { WebhookEventStore } from "../../src/webhook-event-store.js";
import { runProviderContractTests, type ProviderContractFixture } from "../contract/provider.contract.js";

const WEBHOOK_SECRET = "wave-contract-webhook-secret";

function createProvider(webhookEventStore?: WebhookEventStore): WaveProvider {
  return new WaveProvider({ apiKey: "wave_sn_test_contract-key", webhookSecret: WEBHOOK_SECRET, ...(webhookEventStore === undefined ? {} : { webhookEventStore }) });
}

function installHttpMock(): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/checkout/sessions") && init?.method === "POST") {
      return Response.json({ id: "wave-session-success", wave_launch_url: "https://pay.wave.test/checkout/wave-session-success" });
    }
    if (url.endsWith("/refund") && init?.method === "POST") {
      const body = typeof init.body === "string" ? JSON.parse(init.body) as { amount?: number } : {};
      const originalAmount = url.includes("wave-session-unusual") ? Number.MAX_SAFE_INTEGER : 1_000;
      return Response.json({ id: body.amount === undefined ? "wave-refund-total" : "wave-refund-partial", amount: body.amount ?? originalAmount, status: "succeeded" });
    }
    if (url.includes("/checkout/sessions/")) {
      const sessionId = url.substring(url.lastIndexOf("/") + 1);
      if (sessionId === "wave-session-timeout") return Response.json({}, { status: 503 });
      if (sessionId === "wave-session-api-error") {
        return Response.json({ code: "insufficient-funds", message: "Wave code field error" }, { status: 400 });
      }
      return Response.json({
        amount: sessionId === "wave-session-unusual" ? Number.MAX_SAFE_INTEGER : 1_000,
        ...(sessionId === "wave-session-expired"
          ? { checkout_status: "expired", payment_status: "processing", when_expires: "2026-07-22T12:00:00.000Z" }
          : { payment_status: sessionId === "wave-session-failed" ? "cancelled" : "succeeded" }),
        ...(sessionId === "wave-session-failed" ? { error_code: "insufficient-funds" } : {}),
      });
    }
    return Response.json({}, { status: 404 });
  }));
}

const validWebhookBody = JSON.stringify({
  id: "wave-event-1", type: "checkout.session.completed",
  data: { id: "wave-session-success", client_reference: "contract-success", payment_status: "succeeded", when_completed: "2026-07-21T12:00:00.000Z" },
});

const expiredWebhookBody = JSON.stringify({
  id: "wave-event-expired", type: "checkout.session.updated",
  data: {
    id: "wave-session-expired", client_reference: "contract-expired",
    checkout_status: "expired", payment_status: "processing", when_expires: "2026-07-22T12:00:00.000Z",
  },
});

const fixture: ProviderContractFixture = {
  createProvider,
  installHttpMock,
  paymentRequest: { amount: 1_000, currency: "XOF", reference: "contract-success" },
  failedSessionId: "wave-session-failed",
  failedPaymentError: PaymentError.InsufficientFunds,
  timeoutSessionId: "wave-session-timeout",
  validWebhook: {
    rawBody: validWebhookBody,
    headers: { "X-Wave-Signature": createHmac("sha256", WEBHOOK_SECRET).update(validWebhookBody).digest("hex") },
    expectedEvent: {
      id: "wave-event-1", sessionId: "wave-session-success", reference: "contract-success",
      status: PaymentStatus.Success, occurredAt: "2026-07-21T12:00:00.000Z",
    },
  },
  failedWebhook: {
    rawBody: JSON.stringify({
      id: "wave-event-failed", type: "checkout.session.payment_failed",
      data: { id: "wave-session-failed", client_reference: "contract-failed", payment_status: "cancelled", when_completed: "2026-07-21T12:00:00.000Z" },
    }),
    headers: { "X-Wave-Signature": createHmac("sha256", WEBHOOK_SECRET).update(JSON.stringify({
      id: "wave-event-failed", type: "checkout.session.payment_failed",
      data: { id: "wave-session-failed", client_reference: "contract-failed", payment_status: "cancelled", when_completed: "2026-07-21T12:00:00.000Z" },
    })).digest("hex") },
    expectedEvent: {
      id: "wave-event-failed", sessionId: "wave-session-failed", reference: "contract-failed",
      status: PaymentStatus.Failed, occurredAt: "2026-07-21T12:00:00.000Z", error: PaymentError.Unknown,
    },
  },
  invalidWebhook: { rawBody: '{"id":"wave-event-1"}', headers: { "x-wave-signature": "invalid" } },
  apiError: { sessionId: "wave-session-api-error", expectedError: PaymentError.InsufficientFunds },
  refund: { sessionId: "wave-session-success", originalAmount: 1_000, unusualOriginalSessionId: "wave-session-unusual", unusualOriginalAmount: Number.MAX_SAFE_INTEGER, partialAmount: 500, fullAmount: 1_000, supported: true },
  expiration: {
    sessionId: "wave-session-expired",
    supported: true,
    webhook: {
      rawBody: expiredWebhookBody,
      headers: { "X-Wave-Signature": createHmac("sha256", WEBHOOK_SECRET).update(expiredWebhookBody).digest("hex") },
      expectedEvent: {
        id: "wave-event-expired", sessionId: "wave-session-expired", reference: "contract-expired",
        status: PaymentStatus.Expired, occurredAt: "2026-07-22T12:00:00.000Z",
      },
    },
  },
};

afterEach(() => vi.unstubAllGlobals());
runProviderContractTests("Wave", fixture);
