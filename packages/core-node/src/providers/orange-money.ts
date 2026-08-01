import { timingSafeEqual } from "node:crypto";

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
import { InMemoryWebhookEventStore, type WebhookEventStore } from "../webhook-event-store.js";

const BASE_URLS = {
  sandbox: "https://api.sandbox.orange-sonatel.com",
  live: "https://api.orange-sonatel.com",
} as const;

type OrangeMoneyEnvironment = keyof typeof BASE_URLS;

export interface OrangeMoneyProviderConfig {
  clientId: string;
  clientSecret: string;
  merchantCode: string;
  sitename: string;
  environment: OrangeMoneyEnvironment;
  callbackUrl: string;
  webhookApiKey: string;
  /** Override for local API-compatible mocks. */
  baseUrl?: string;
  webhookEventStore?: WebhookEventStore;
}

interface OrangeApiErrorBody {
  code?: string | number;
  message?: string;
  error?: string;
}

interface OrangeTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface OrangePrepareResponse {
  paymentUrl?: string;
}

interface OrangeTransaction {
  status?: string;
  code?: string | number;
}

interface OrangeTransactionSearchResponse {
  transactions?: OrangeTransaction[];
}

interface OrangeWebhookPayload {
  id?: string;
  transactionId?: string;
  reference?: string;
  status?: string;
  code?: string | number;
  timestamp?: string;
}

/** Error intentionally reduced to the common PaymentError code. */
export class OrangeMoneyProviderError extends Error {
  public constructor(public readonly code: PaymentError, message: string) {
    super(message);
    this.name = "OrangeMoneyProviderError";
  }
}

export class OrangeMoneyProvider implements PaymentProvider {
  private accessToken?: string;
  private accessTokenExpiresAt = 0;
  private readonly webhookEventStore: WebhookEventStore;

  public constructor(private readonly config: OrangeMoneyProviderConfig) {
    this.webhookEventStore = config.webhookEventStore ?? new InMemoryWebhookEventStore();
  }

  public async initiatePayment(params: PaymentRequest): Promise<PaymentSession> {
    const response = await this.request(
      "/v1/onlinePayment/prepare",
      {
        method: "POST",
        body: JSON.stringify({
          merchantCode: this.config.merchantCode,
          sitename: this.config.sitename,
          amount: params.amount,
          reference: params.reference,
          urls: {
            cancelUrl: params.failureUrl ?? this.config.callbackUrl,
            successUrl: params.successUrl ?? this.config.callbackUrl,
            callbackUrl: this.config.callbackUrl,
          },
        }),
      }
    );
    const body = await this.readJson<OrangePrepareResponse>(response);

    if (typeof body.paymentUrl !== "string" || body.paymentUrl.length === 0) {
      throw new OrangeMoneyProviderError(
        PaymentError.Unknown,
        "Orange Money prepare response is missing paymentUrl"
      );
    }

    return {
      id: params.reference,
      reference: params.reference,
      amount: params.amount,
      currency: params.currency,
      status: PaymentStatus.Pending,
      paymentUrl: body.paymentUrl,
    };
  }

  public async checkStatus(sessionId: string): Promise<PaymentStatusResult> {
    const query = new URLSearchParams({ reference: sessionId, type: "WEB_PAYMENT" });
    const response = await this.request(`/api/eWallet/v1/transactions?${query.toString()}`);
    const body = await this.readJson<OrangeTransactionSearchResponse>(response);
    const transaction = body.transactions?.[0];

    if (transaction === undefined || typeof transaction.status !== "string") {
      throw new OrangeMoneyProviderError(
        PaymentError.Unknown,
        "Orange Money returned no transaction for the payment reference"
      );
    }

    return this.toPaymentStatusResult(transaction.status, transaction.code);
  }

  public async handleWebhook(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<PaymentEvent> {
    const receivedApiKey = this.findHeader(headers, "x-api-key");

    if (receivedApiKey === undefined || !this.isValidWebhookKey(receivedApiKey)) {
      throw new OrangeMoneyProviderError(PaymentError.Unknown, "Invalid Orange Money webhook API key");
    }

    const serializedBody = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const payload = this.parseWebhookPayload(serializedBody);
    const sessionId = payload.reference ?? payload.transactionId;

    if (sessionId === undefined || sessionId.length === 0) {
      throw new OrangeMoneyProviderError(
        PaymentError.Unknown,
        "Orange Money webhook is missing a transaction reference"
      );
    }

    const status = this.toPaymentStatus(payload.status ?? "");
    const ref = payload.reference === undefined ? {} : { reference: payload.reference };
    const occurredAt = payload.timestamp ?? new Date().toISOString();
    const id = payload.id ?? payload.transactionId ?? sessionId;

    const event: PaymentEvent = status === PaymentStatus.Failed
      ? { id, sessionId, status: PaymentStatus.Failed, ...ref, occurredAt, error: this.mapErrorCode(payload.code ?? "UNKNOWN") }
      : { id, sessionId, status, ...ref, occurredAt };
    return this.webhookEventStore.record(event);
  }

  public async refund(_sessionId: string, _amount?: number): Promise<RefundResult> {
    throw new OrangeMoneyProviderError(
      PaymentError.Unknown,
      "Orange Money eWallet public API does not support merchant refunds in self-service"
    );
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
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

    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl()}/oauth/v1/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
      });
    } catch (error: unknown) {
      throw this.toProviderError(error);
    }

    if (!response.ok) {
      throw await this.toResponseError(response);
    }

    const body = await this.readJson<OrangeTokenResponse>(response);
    if (typeof body.access_token !== "string" || body.access_token.length === 0) {
      throw new OrangeMoneyProviderError(PaymentError.Unknown, "Orange Money token response is invalid");
    }

    this.accessToken = body.access_token;
    const expiresInSeconds = typeof body.expires_in === "number" ? body.expires_in : 300;
    this.accessTokenExpiresAt = Date.now() + Math.max(0, expiresInSeconds - 30) * 1_000;
    return this.accessToken;
  }

  private baseUrl(): string {
    return (this.config.baseUrl ?? BASE_URLS[this.config.environment]).replace(/\/$/, "");
  }

  private async toResponseError(response: Response): Promise<OrangeMoneyProviderError> {
    const body = await this.readJsonOrEmpty<OrangeApiErrorBody>(response);
    const message = body.message ?? body.error ?? `Orange Money request failed with HTTP ${response.status}`;
    return new OrangeMoneyProviderError(this.mapErrorCode(body.code ?? response.status), message);
  }

  private toProviderError(error: unknown): OrangeMoneyProviderError {
    if (error instanceof OrangeMoneyProviderError) {
      return error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      return new OrangeMoneyProviderError(PaymentError.ProviderTimeout, error.message);
    }

    return new OrangeMoneyProviderError(PaymentError.ProviderTimeout, "Orange Money request failed");
  }

  private mapErrorCode(code: string | number): PaymentError {
    const normalizedCode = String(code);

    if (normalizedCode === "2020" || normalizedCode === "2021") {
      return PaymentError.InsufficientFunds;
    }
    if (normalizedCode === "2000" || normalizedCode === "2001") {
      return PaymentError.InvalidPhone;
    }
    if (["500", "50", "51", "1", "2", "5"].includes(normalizedCode)) {
      return PaymentError.ProviderTimeout;
    }
    return PaymentError.Unknown;
  }

  private toPaymentStatus(status: string): PaymentStatus {
    switch (status.toUpperCase()) {
      case "ACCEPTED":
      case "SUCCESS":
        return PaymentStatus.Success;
      case "PENDING":
      case "INITIATED":
        return PaymentStatus.Pending;
      case "CANCELLED":
      case "REJECTED":
      case "FAILED":
        return PaymentStatus.Failed;
      default:
        throw new OrangeMoneyProviderError(PaymentError.Unknown, "Unknown Orange Money payment status");
    }
  }

  private toPaymentStatusResult(status: string, errorCode?: string | number): PaymentStatusResult {
    const paymentStatus = this.toPaymentStatus(status);
    if (paymentStatus !== PaymentStatus.Failed) {
      return { status: paymentStatus };
    }

    return { status: paymentStatus, error: this.mapErrorCode(errorCode ?? "UNKNOWN") };
  }

  private findHeader(
    headers: Record<string, string | string[] | undefined>,
    expectedName: string
  ): string | undefined {
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === expectedName && typeof value === "string") {
        return value;
      }
      if (name.toLowerCase() === expectedName && Array.isArray(value) && value.length === 1) {
        return value[0];
      }
    }
    return undefined;
  }

  private isValidWebhookKey(receivedApiKey: string): boolean {
    const expected = Buffer.from(this.config.webhookApiKey);
    const received = Buffer.from(receivedApiKey);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private parseWebhookPayload(serializedBody: string): OrangeWebhookPayload {
    try {
      const payload: unknown = JSON.parse(serializedBody);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Error("Webhook payload must be an object");
      }
      return payload as OrangeWebhookPayload;
    } catch {
      throw new OrangeMoneyProviderError(PaymentError.Unknown, "Invalid Orange Money webhook payload");
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
