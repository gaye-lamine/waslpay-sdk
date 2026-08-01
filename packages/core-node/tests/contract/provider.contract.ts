import { describe, expect, it } from "vitest";

import {
  PaymentError,
  PaymentStatus,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentRequest,
} from "../../src/types.js";
import { InMemoryWebhookEventStore, type WebhookEventStore } from "../../src/webhook-event-store.js";

type WebhookHeaders = Record<string, string | string[] | undefined>;

interface WebhookFixture {
  rawBody: string;
  headers: WebhookHeaders;
  expectedEvent: PaymentEvent;
}

interface RefundFixture {
  sessionId: string;
  originalAmount: number;
  unusualOriginalSessionId: string;
  unusualOriginalAmount: number;
  partialAmount: number;
  fullAmount: number;
  supported: boolean;
  status?: PaymentStatus;
}

interface ExpirationFixture {
  sessionId: string;
  supported: boolean;
  webhook?: WebhookFixture;
}

interface ApiErrorFixture {
  sessionId: string;
  expectedError: PaymentError;
}

export interface ProviderContractFixture {
  createProvider(eventStore?: WebhookEventStore): PaymentProvider;
  installHttpMock(): void;
  paymentRequest: PaymentRequest;
  failedSessionId: string;
  failedPaymentError: PaymentError;
  timeoutSessionId: string;
  validWebhook: WebhookFixture;
  failedWebhook?: WebhookFixture;
  invalidWebhook: Pick<WebhookFixture, "rawBody" | "headers">;
  apiError?: ApiErrorFixture;
  refund: RefundFixture;
  expiration: ExpirationFixture;
}

/**
 * Executes every mandatory provider contract scenario against provider-specific
 * HTTP fixtures. Provider test files supply data only; assertions live here.
 */
export function runProviderContractTests(providerName: string, fixture: ProviderContractFixture): void {
  describe(`${providerName} provider contract`, () => {
    it("paiement réussi", async () => {
      fixture.installHttpMock();
      const provider = fixture.createProvider();

      const session = await provider.initiatePayment(fixture.paymentRequest);

      expect(session).toMatchObject({
        reference: fixture.paymentRequest.reference,
        amount: fixture.paymentRequest.amount,
        currency: fixture.paymentRequest.currency,
        status: PaymentStatus.Pending,
      });
      expect(session.id).not.toBe("");
      await expect(provider.checkStatus(session.id)).resolves.toMatchObject({ status: PaymentStatus.Success });
    });

    it("paiement échoué", async () => {
      fixture.installHttpMock();
      const result = await fixture.createProvider().checkStatus(fixture.failedSessionId);

      expect(result.status).toBe(PaymentStatus.Failed);
      expect(result.error).toBe(fixture.failedPaymentError);
    });

    it("webhook valide", async () => {
      await expect(
        fixture.createProvider().handleWebhook(fixture.validWebhook.rawBody, fixture.validWebhook.headers)
      ).resolves.toEqual(fixture.validWebhook.expectedEvent);
    });

    it.skipIf(fixture.failedWebhook === undefined)("webhook d'échec attache un PaymentError", async () => {
      const event = await fixture.createProvider().handleWebhook(fixture.failedWebhook!.rawBody, fixture.failedWebhook!.headers);
      expect(event.status).toBe(PaymentStatus.Failed);
      expect(event.error).toBeDefined();
    });

    it("signature de webhook invalide", async () => {
      await expect(
        fixture.createProvider().handleWebhook(fixture.invalidWebhook.rawBody, fixture.invalidWebhook.headers)
      ).rejects.toMatchObject({ code: PaymentError.Unknown });
    });

    it.skipIf(fixture.apiError === undefined)("erreur API via le champ code", async () => {
      fixture.installHttpMock();

      await expect(fixture.createProvider().checkStatus(fixture.apiError!.sessionId)).rejects.toMatchObject({
        code: fixture.apiError!.expectedError,
      });
    });

    it("remboursement partiel", async () => {
      fixture.installHttpMock();
      const provider = fixture.createProvider();

      if (!fixture.refund.supported) {
        await expect(provider.refund(fixture.refund.sessionId, fixture.refund.partialAmount)).rejects.toMatchObject({
          code: PaymentError.Unknown,
        });
        return;
      }

      await expect(provider.refund(fixture.refund.sessionId, fixture.refund.partialAmount)).resolves.toMatchObject({
        sessionId: fixture.refund.sessionId,
        amount: fixture.refund.partialAmount,
        status: fixture.refund.status ?? PaymentStatus.Success,
      });
    });

    it("remboursement total", async () => {
      fixture.installHttpMock();
      const provider = fixture.createProvider();

      if (!fixture.refund.supported) {
        await expect(provider.refund(fixture.refund.sessionId)).rejects.toMatchObject({
          code: PaymentError.Unknown,
        });
        return;
      }

      await expect(provider.refund(fixture.refund.sessionId)).resolves.toMatchObject({
        sessionId: fixture.refund.sessionId,
        amount: fixture.refund.fullAmount,
        status: fixture.refund.status ?? PaymentStatus.Success,
      });
    });

    it.skipIf(!fixture.refund.supported)("montant de remboursement nul", async () => {
      await expect(fixture.createProvider().refund(fixture.refund.sessionId, 0)).rejects.toMatchObject({
        code: PaymentError.InvalidRefundAmount,
      });
    });

    it.skipIf(!fixture.refund.supported)("montant de remboursement négatif", async () => {
      await expect(fixture.createProvider().refund(fixture.refund.sessionId, -1)).rejects.toMatchObject({
        code: PaymentError.InvalidRefundAmount,
      });
    });

    it.skipIf(!fixture.refund.supported)("montant de remboursement décimal", async () => {
      await expect(fixture.createProvider().refund(fixture.refund.sessionId, 1.5)).rejects.toMatchObject({
        code: PaymentError.InvalidRefundAmount,
      });
    });

    it.skipIf(!fixture.refund.supported)("montant de remboursement supérieur à l'original", async () => {
      fixture.installHttpMock();

      await expect(
        fixture.createProvider().refund(fixture.refund.sessionId, fixture.refund.originalAmount + 1)
      ).rejects.toMatchObject({
        code: PaymentError.RefundAmountExceedsBalance,
      });
    });

    it.skipIf(!fixture.refund.supported)("remboursement total exempté de la limite de montant", async () => {
      fixture.installHttpMock();

      await expect(
        fixture.createProvider().refund(fixture.refund.unusualOriginalSessionId)
      ).resolves.toMatchObject({
        sessionId: fixture.refund.unusualOriginalSessionId,
        amount: fixture.refund.unusualOriginalAmount,
        status: fixture.refund.status ?? PaymentStatus.Success,
      });
    });

    it.skipIf(!fixture.expiration.supported)("session expirée", async () => {
      fixture.installHttpMock();
      await expect(fixture.createProvider().checkStatus(fixture.expiration.sessionId)).resolves.toEqual({
        status: PaymentStatus.Expired,
      });

      if (fixture.expiration.webhook !== undefined) {
        await expect(
          fixture.createProvider().handleWebhook(
            fixture.expiration.webhook.rawBody,
            fixture.expiration.webhook.headers
          )
        ).resolves.toEqual(fixture.expiration.webhook.expectedEvent);
      }
    });

    it("timeout", async () => {
      fixture.installHttpMock();
      await expect(fixture.createProvider().checkStatus(fixture.timeoutSessionId)).rejects.toMatchObject({
        code: PaymentError.ProviderTimeout,
      });
    });

    it("webhook livré deux fois", async () => {
      const store = new InMemoryWebhookEventStore();
      const provider = fixture.createProvider(store);

      const firstEvent = await provider.handleWebhook(fixture.validWebhook.rawBody, fixture.validWebhook.headers);
      const duplicateEvent = await provider.handleWebhook(fixture.validWebhook.rawBody, fixture.validWebhook.headers);

      expect(duplicateEvent).toEqual(firstEvent);
      expect(store.size).toBe(1);
      expect(store.record(firstEvent)).toEqual(firstEvent);
      expect(store.size).toBe(1);
    });
  });
}
