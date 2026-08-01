import { createHmac, timingSafeEqual } from "node:crypto";

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

const WAVE_API_BASE_URL = "https://api.wave.com/v1";

export interface WaveProviderConfig {
  apiKey: string;
  webhookSecret: string;
  /** Override for local API-compatible mocks. Defaults to the Wave API. */
  baseUrl?: string;
  webhookEventStore?: WebhookEventStore;
}

interface WaveCheckoutSession {
  id?: string;
  amount?: string | number;
  currency?: string;
  client_reference?: string | null;
  wave_launch_url?: string;
  /**
   * Wave checkout lifecycle. It takes priority over payment_status for expiry
   * detection because payment_status has no documented "expired" value.
   */
  checkout_status?: "open" | "complete" | "expired";
  payment_status?: string;
  error_code?: string;
  when_expires?: string;
  when_completed?: string;
  when_created?: string;
}

interface WaveRefundResponse {
  id?: string;
  amount?: string | number;
  status?: string;
}

interface WaveErrorResponse {
  /** Wave may return a top-level `code` for API-level errors. */
  code?: string;
  error_code?: string;
  error_message?: string;
  message?: string;
}

interface WaveWebhookPayload {
  id?: string;
  type?: string;
  data?: WaveCheckoutSession;
}

/** Error intentionally reduced to the common PaymentError code. */
export class WaveProviderError extends Error {
  public constructor(public readonly code: PaymentError, message: string) {
    super(message);
    this.name = "WaveProviderError";
  }
}

export class WaveProvider implements PaymentProvider {
  private readonly webhookEventStore: WebhookEventStore;

  public constructor(private readonly config: WaveProviderConfig) {
    this.webhookEventStore = config.webhookEventStore ?? new InMemoryWebhookEventStore();
  }

  public async initiatePayment(params: PaymentRequest): Promise<PaymentSession> {
    const response = await this.request("/checkout/sessions", {
      method: "POST",
      body: JSON.stringify({
        amount: params.amount,
        currency: "XOF",
        ...(params.failureUrl === undefined ? {} : { error_url: params.failureUrl }),
        ...(params.successUrl === undefined ? {} : { success_url: params.successUrl }),
        client_reference: params.reference,
      }),
    });
    const session = await this.readJson<WaveCheckoutSession>(response);

    if (typeof session.id !== "string" || session.id.length === 0) {
      throw new WaveProviderError(PaymentError.Unknown, "Wave checkout response is missing id");
    }

    return {
      id: session.id,
      reference: params.reference,
      amount: params.amount,
      currency: params.currency,
      status: PaymentStatus.Pending,
      ...(session.wave_launch_url === undefined ? {} : { paymentUrl: session.wave_launch_url }),
    };
  }

  public async checkStatus(sessionId: string): Promise<PaymentStatusResult> {
    const session = await this.getCheckoutSession(sessionId);

    // checkout_status is evaluated first: only it can explicitly represent expiry.
    if (session.checkout_status === "expired") {
      return { status: PaymentStatus.Expired };
    }
    if (typeof session.payment_status !== "string") {
      throw new WaveProviderError(PaymentError.Unknown, "Wave checkout response is missing payment_status");
    }
    return this.toPaymentStatusResult(session.payment_status, session.error_code);
  }

  public async handleWebhook(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<PaymentEvent> {
    const signature = this.findHeader(headers, "x-wave-signature");
    const rawBytes = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;

    if (signature === undefined || !this.isValidSignature(rawBytes, signature)) {
      throw new WaveProviderError(PaymentError.Unknown, "Invalid Wave webhook signature");
    }

    const payload = this.parseWebhookPayload(rawBytes.toString("utf8"));
    const data = payload.data;
    const sessionId = data?.id;
    if (sessionId === undefined || sessionId.length === 0) {
      throw new WaveProviderError(PaymentError.Unknown, "Wave webhook is missing checkout session id");
    }

    const status = this.toWebhookStatus(payload.type, data?.checkout_status, data?.payment_status);
    const ref = data?.client_reference === null || data?.client_reference === undefined ? {} : { reference: data.client_reference };
    const occurredAt = data?.when_completed ?? data?.when_expires ?? data?.when_created ?? new Date().toISOString();
    const id = payload.id ?? sessionId;

    const event: PaymentEvent = status === PaymentStatus.Failed
      ? { id, sessionId, status: PaymentStatus.Failed, ...ref, occurredAt, error: this.mapError(200, data?.error_code) }
      : { id, sessionId, status, ...ref, occurredAt };
    return this.webhookEventStore.record(event);
  }

  public async refund(sessionId: string, amount?: number): Promise<RefundResult> {
    if (amount !== undefined) {
      validateRefundAmount(
        amount,
        (code, message) => new WaveProviderError(code, message)
      );
    }

    const session = await this.getCheckoutSession(sessionId);
    const originalAmount = this.parseOriginalAmount(session.amount);

    if (amount !== undefined && amount > originalAmount) {
      throw new WaveProviderError(
        PaymentError.RefundAmountExceedsBalance,
        "Refund amount exceeds the original payment amount"
      );
    }

    const refundAmount = amount ?? originalAmount;

    const response = await this.request(`/checkout/sessions/${encodeURIComponent(sessionId)}/refund`, {
      method: "POST",
      ...(amount === undefined ? {} : { body: JSON.stringify({ amount }) }),
    });
    const refund = await this.readJson<WaveRefundResponse>(response);

    if (typeof refund.id !== "string" || typeof refund.amount !== "number") {
      throw new WaveProviderError(PaymentError.Unknown, "Wave refund response is incomplete");
    }

    return {
      sessionId,
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status === undefined ? PaymentStatus.Success : this.toPaymentStatus(refund.status),
    };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
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

  private baseUrl(): string {
    return (this.config.baseUrl ?? WAVE_API_BASE_URL).replace(/\/$/, "");
  }

  private async getCheckoutSession(sessionId: string): Promise<WaveCheckoutSession> {
    const response = await this.request(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
    return this.readJson<WaveCheckoutSession>(response);
  }

  private parseOriginalAmount(amount: string | number | undefined): number {
    const parsed = typeof amount === "number" ? amount : Number(amount);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new WaveProviderError(PaymentError.Unknown, "Wave checkout response is missing a valid amount");
    }
    return parsed;
  }

  private async toResponseError(response: Response): Promise<WaveProviderError> {
    const body = await this.readJsonOrEmpty<WaveErrorResponse>(response);
    const message = body.error_message ?? body.message ?? `Wave request failed with HTTP ${response.status}`;
    return new WaveProviderError(this.mapError(response.status, body.error_code ?? body.code), message);
  }

  private toProviderError(error: unknown): WaveProviderError {
    if (error instanceof WaveProviderError) {
      return error;
    }
    return new WaveProviderError(
      PaymentError.ProviderTimeout,
      error instanceof Error ? error.message : "Wave request failed"
    );
  }

  private mapError(httpStatus: number, waveCode: string | undefined): PaymentError {
    if (waveCode === "insufficient-funds") {
      return PaymentError.InsufficientFunds;
    }
    if (waveCode === "payer-mobile-mismatch" || waveCode === "invalid-phone") {
      return PaymentError.InvalidPhone;
    }
    if (waveCode === "payment-cancelled" || waveCode === "user-cancelled") {
      return PaymentError.UserCancelled;
    }
    if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
      return PaymentError.ProviderTimeout;
    }
    return PaymentError.Unknown;
  }

  private toPaymentStatus(status: string): PaymentStatus {
    switch (status.toLowerCase()) {
      case "succeeded":
      case "success":
        return PaymentStatus.Success;
      case "processing":
      case "pending":
        return PaymentStatus.Pending;
      case "cancelled":
      case "failed":
        return PaymentStatus.Failed;
      default:
        throw new WaveProviderError(PaymentError.Unknown, "Unknown Wave payment status");
    }
  }

  private toPaymentStatusResult(status: string, errorCode?: string): PaymentStatusResult {
    const paymentStatus = this.toPaymentStatus(status);
    if (paymentStatus !== PaymentStatus.Failed) {
      return { status: paymentStatus };
    }

    return { status: paymentStatus, error: this.mapError(200, errorCode) };
  }

  private toWebhookStatus(
    type: string | undefined,
    checkoutStatus: WaveCheckoutSession["checkout_status"],
    paymentStatus: string | undefined
  ): PaymentStatus {
    // Wave currently documents no dedicated webhook event type for expiration.
    // Accept an expired checkout_status even when the event type is otherwise unknown.
    if (checkoutStatus === "expired") {
      return PaymentStatus.Expired;
    }
    if (type === "checkout.session.completed") {
      return PaymentStatus.Success;
    }
    if (type === "checkout.session.payment_failed") {
      return PaymentStatus.Failed;
    }
    if (paymentStatus === undefined) {
      throw new WaveProviderError(PaymentError.Unknown, "Wave webhook has an unknown event type");
    }
    return this.toPaymentStatus(paymentStatus);
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

  private isValidSignature(rawBody: Buffer, headerValue: string): boolean {
    const expectedSignature = createHmac("sha256", this.config.webhookSecret).update(rawBody).digest("hex");
    const candidates = headerValue.split(",").map((part) => part.trim().replace(/^v1=/, ""));

    return candidates.some((candidate) => {
      const expected = Buffer.from(expectedSignature);
      const received = Buffer.from(candidate);
      return expected.length === received.length && timingSafeEqual(expected, received);
    });
  }

  private parseWebhookPayload(serializedBody: string): WaveWebhookPayload {
    try {
      const payload: unknown = JSON.parse(serializedBody);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Error("Webhook payload must be an object");
      }
      return payload as WaveWebhookPayload;
    } catch {
      throw new WaveProviderError(PaymentError.Unknown, "Invalid Wave webhook payload");
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
