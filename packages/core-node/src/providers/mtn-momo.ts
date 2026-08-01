import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  PaymentError,
  PaymentStatus,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentRequest,
  type PaymentSession,
  type PaymentStatusResult,
  type RefundResult,
} from "../types.js";
import { validateRefundAmount } from "../refund-validation.js";
import { InMemoryWebhookEventStore, type WebhookEventStore } from "../webhook-event-store.js";

const BASE_URLS = {
  sandbox: "https://sandbox.momodeveloper.mtn.com",
  production: "https://proxy.momoapi.mtn.com",
} as const;

type MtnMomoEnvironment = keyof typeof BASE_URLS;

export interface MtnMomoProviderConfig {
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
  targetEnvironment: MtnMomoEnvironment;
  defaultCurrency: string;
  /** Override for local API-compatible mocks. */
  baseUrl?: string;
  webhookEventStore?: WebhookEventStore;
}

interface MtnTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface MtnRequestToPay {
  amount?: string;
  currency?: string;
  externalId?: string;
  referenceId?: string;
  status?: string;
  code?: string;
}

interface MtnErrorResponse {
  code?: string;
  message?: string;
}

interface MtnWebhookPayload extends MtnRequestToPay {
  id?: string;
  timestamp?: string;
}

export class MtnMomoProviderError extends Error {
  public constructor(public readonly code: PaymentError, message: string) {
    super(message);
    this.name = "MtnMomoProviderError";
  }
}

export class MtnMomoProvider implements PaymentProvider {
  private accessToken?: string;
  private accessTokenExpiresAt = 0;
  private readonly webhookEventStore: WebhookEventStore;

  public constructor(private readonly config: MtnMomoProviderConfig) {
    this.webhookEventStore = config.webhookEventStore ?? new InMemoryWebhookEventStore();
  }

  public async initiatePayment(params: PaymentRequest): Promise<PaymentSession> {
    if (params.customerPhone === undefined || params.customerPhone.length === 0) {
      throw new MtnMomoProviderError(PaymentError.InvalidPhone, "MTN MoMo requires customerPhone");
    }

    const sessionId = randomUUID();
    await this.request("/collection/v1_0/requesttopay", {
      method: "POST",
      headers: { "X-Reference-Id": sessionId },
      body: JSON.stringify({
        amount: params.amount.toString(),
        currency: params.currency || this.config.defaultCurrency,
        externalId: params.reference,
        payer: { partyIdType: "MSISDN", partyId: params.customerPhone },
        payerMessage: "Payment request",
        payeeNote: params.reference,
      }),
    });

    return {
      id: sessionId,
      reference: params.reference,
      amount: params.amount,
      currency: params.currency || this.config.defaultCurrency,
      status: PaymentStatus.Pending,
    };
  }

  public async checkStatus(sessionId: string): Promise<PaymentStatusResult> {
    const transaction = await this.getRequestToPay(sessionId);
    if (typeof transaction.status !== "string") {
      throw new MtnMomoProviderError(PaymentError.Unknown, "MTN MoMo response is missing status");
    }
    return this.toPaymentStatusResult(transaction.status, transaction.code);
  }

  public async handleWebhook(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<PaymentEvent> {
    const receivedKey = this.findHeader(headers, "ocp-apim-subscription-key");
    if (receivedKey === undefined || !this.isValidSubscriptionKey(receivedKey)) {
      throw new MtnMomoProviderError(PaymentError.Unknown, "Invalid MTN MoMo webhook security key");
    }

    const serializedBody = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const payload = this.parseWebhookPayload(serializedBody);
    const sessionId = payload.referenceId;
    if (sessionId === undefined || sessionId.length === 0 || typeof payload.status !== "string") {
      throw new MtnMomoProviderError(PaymentError.Unknown, "Incomplete MTN MoMo webhook payload");
    }

    const status = this.toPaymentStatus(payload.status);
    const ref = payload.externalId === undefined ? {} : { reference: payload.externalId };
    const occurredAt = payload.timestamp ?? new Date().toISOString();
    const id = payload.id ?? sessionId;

    const event: PaymentEvent = status === PaymentStatus.Failed
      ? { id, sessionId, status: PaymentStatus.Failed, ...ref, occurredAt, error: this.mapError(200, payload.code) }
      : { id, sessionId, status, ...ref, occurredAt };
    return this.webhookEventStore.record(event);
  }

  public async refund(sessionId: string, amount?: number): Promise<RefundResult> {
    if (amount !== undefined) {
      validateRefundAmount(
        amount,
        (code, message) => new MtnMomoProviderError(code, message)
      );
    }

    const originalTransaction = await this.getRequestToPay(sessionId);
    const originalAmount = this.parseAmount(originalTransaction.amount);

    if (amount !== undefined && amount > originalAmount) {
      throw new MtnMomoProviderError(
        PaymentError.RefundAmountExceedsBalance,
        "Refund amount exceeds the original payment amount"
      );
    }

    const refundAmount = amount ?? originalAmount;
    const refundId = randomUUID();

    await this.request("/collection/v1_0/refund", {
      method: "POST",
      headers: { "X-Reference-Id": refundId },
      body: JSON.stringify({
        amount: refundAmount.toString(),
        currency: this.config.defaultCurrency,
        externalId: sessionId,
        payerMessage: "Refund",
        payeeNote: "Refund",
      }),
    });

    return {
      sessionId,
      refundId,
      amount: refundAmount,
      status: PaymentStatus.Pending,
    };
  }

  private async getRequestToPay(sessionId: string): Promise<MtnRequestToPay> {
    const response = await this.request(`/collection/v1_0/requesttopay/${encodeURIComponent(sessionId)}`);
    return this.readJson<MtnRequestToPay>(response);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Target-Environment": this.config.targetEnvironment,
          "Ocp-Apim-Subscription-Key": this.config.subscriptionKey,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    } catch (error: unknown) {
      throw this.toProviderError(error);
    }

    if (!response.ok) {
      throw await this.toResponseError(response);
    }
    return response;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken !== undefined && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    const credentials = Buffer.from(`${this.config.apiUser}:${this.config.apiKey}`).toString("base64");
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}/collection/token/`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Ocp-Apim-Subscription-Key": this.config.subscriptionKey,
        },
      });
    } catch (error: unknown) {
      throw this.toProviderError(error);
    }

    if (!response.ok) {
      throw await this.toResponseError(response);
    }
    const body = await this.readJson<MtnTokenResponse>(response);
    if (typeof body.access_token !== "string" || body.access_token.length === 0) {
      throw new MtnMomoProviderError(PaymentError.Unknown, "MTN MoMo token response is invalid");
    }

    this.accessToken = body.access_token;
    const expiresInSeconds = typeof body.expires_in === "number" ? body.expires_in : 300;
    this.accessTokenExpiresAt = Date.now() + Math.max(0, expiresInSeconds - 30) * 1_000;
    return this.accessToken;
  }

  private baseUrl(): string {
    return (this.config.baseUrl ?? BASE_URLS[this.config.targetEnvironment]).replace(/\/$/, "");
  }

  private async toResponseError(response: Response): Promise<MtnMomoProviderError> {
    const body = await this.readJsonOrEmpty<MtnErrorResponse>(response);
    const message = body.message ?? `MTN MoMo request failed with HTTP ${response.status}`;
    return new MtnMomoProviderError(this.mapError(response.status, body.code), message);
  }

  private toProviderError(error: unknown): MtnMomoProviderError {
    return new MtnMomoProviderError(
      PaymentError.ProviderTimeout,
      error instanceof Error ? error.message : "MTN MoMo request failed"
    );
  }

  private mapError(httpStatus: number, mtnCode: string | undefined): PaymentError {
    if (["RESOURCE_NOT_FOUND", "PAYER_NOT_FOUND", "NOT_ENOUGH_FUNDS"].includes(mtnCode ?? "")) {
      return PaymentError.InsufficientFunds;
    }
    if (["APPROVAL_REJECTED", "EXPIRED"].includes(mtnCode ?? "")) {
      return PaymentError.UserCancelled;
    }
    if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
      return PaymentError.ProviderTimeout;
    }
    return PaymentError.Unknown;
  }

  private toPaymentStatus(status: string): PaymentStatus {
    switch (status.toUpperCase()) {
      case "SUCCESSFUL":
        return PaymentStatus.Success;
      case "PENDING":
        return PaymentStatus.Pending;
      case "FAILED":
        return PaymentStatus.Failed;
      default:
        throw new MtnMomoProviderError(PaymentError.Unknown, "Unknown MTN MoMo payment status");
    }
  }

  private toPaymentStatusResult(status: string, errorCode?: string): PaymentStatusResult {
    const paymentStatus = this.toPaymentStatus(status);
    if (paymentStatus !== PaymentStatus.Failed) {
      return { status: paymentStatus };
    }

    return { status: paymentStatus, error: this.mapError(200, errorCode) };
  }

  private parseAmount(value: string | undefined): number {
    const amount = value === undefined ? Number.NaN : Number(value);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new MtnMomoProviderError(PaymentError.Unknown, "MTN MoMo response is missing original amount");
    }
    return amount;
  }

  private findHeader(
    headers: Record<string, string | string[] | undefined>,
    expectedName: string
  ): string | undefined {
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== expectedName) {
        continue;
      }
      if (typeof value === "string") {
        return value;
      }
      if (Array.isArray(value) && value.length === 1) {
        return value[0];
      }
    }
    return undefined;
  }

  private isValidSubscriptionKey(receivedKey: string): boolean {
    const expected = Buffer.from(this.config.subscriptionKey);
    const received = Buffer.from(receivedKey);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private parseWebhookPayload(serializedBody: string): MtnWebhookPayload {
    try {
      const payload: unknown = JSON.parse(serializedBody);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Error("Webhook payload must be an object");
      }
      return payload as MtnWebhookPayload;
    } catch {
      throw new MtnMomoProviderError(PaymentError.Unknown, "Invalid MTN MoMo webhook payload");
    }
  }

  private async readJson<T>(response: Response): Promise<T> {
    const body: unknown = await response.json();
    return body as T;
  }

  private async readJsonOrEmpty<T>(response: Response): Promise<T> {
    try {
      return await this.readJson<T>(response);
    } catch {
      return {} as T;
    }
  }
}
