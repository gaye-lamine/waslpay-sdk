export interface PaymentProvider {
  initiatePayment(params: PaymentRequest): Promise<PaymentSession>;
  checkStatus(sessionId: string): Promise<PaymentStatusResult>;
  handleWebhook(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<PaymentEvent>;
  refund(sessionId: string, amount?: number): Promise<RefundResult>;
}

export interface PaymentRequest {
  amount: number;
  currency: string;
  reference: string;
  customerPhone?: string;
  successUrl?: string;
  failureUrl?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface PaymentSession {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentUrl?: string;
  expiresAt?: string;
}

export enum PaymentStatus {
  Pending = "pending",
  Success = "success",
  Failed = "failed",
  Expired = "expired",
}

export type PaymentStatusResult =
  | {
      status: PaymentStatus.Pending | PaymentStatus.Success | PaymentStatus.Expired;
      error?: never;
    }
  | {
      status: PaymentStatus.Failed;
      error: PaymentError;
    };

export type PaymentEvent =
  | {
      id: string;
      sessionId: string;
      status: PaymentStatus.Pending | PaymentStatus.Success | PaymentStatus.Expired;
      reference?: string;
      occurredAt: string;
      error?: never;
    }
  | {
      id: string;
      sessionId: string;
      status: PaymentStatus.Failed;
      reference?: string;
      occurredAt: string;
      error: PaymentError;
    };

export interface RefundResult {
  sessionId: string;
  refundId: string;
  amount: number;
  status: PaymentStatus;
}

export enum PaymentError {
  InsufficientFunds = "INSUFFICIENT_FUNDS",
  ProviderTimeout = "PROVIDER_TIMEOUT",
  InvalidPhone = "INVALID_PHONE",
  InvalidRefundAmount = "INVALID_REFUND_AMOUNT",
  RefundAmountExceedsBalance = "REFUND_AMOUNT_EXCEEDS_BALANCE",
  UserCancelled = "USER_CANCELLED",
  Unknown = "UNKNOWN",
}
