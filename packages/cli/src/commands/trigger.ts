import { createHmac, randomUUID } from "node:crypto";

type Provider = "wave" | "orange" | "mtn";
type Outcome = "success" | "failed";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TriggerCommandOptions {
  target: string;
  secret: string;
}

// ---------------------------------------------------------------------------
// Provider-specific payload builders
// ---------------------------------------------------------------------------

export interface WaveWebhookPayload {
  id: string;
  type: string;
  data: {
    id: string;
    client_reference: string;
    payment_status: string;
    checkout_status: string;
  };
  occurredAt: string;
}

export interface OrangeWebhookPayload {
  id: string;
  transactionId: string;
  reference: string;
  status: string;
  timestamp: string;
}

export interface MtnWebhookPayload {
  id: string;
  referenceId: string;
  externalId: string;
  status: string;
  timestamp: string;
}

export type ProviderWebhookPayload = WaveWebhookPayload | OrangeWebhookPayload | MtnWebhookPayload;

export function buildWavePayload(outcome: Outcome, reference?: string): WaveWebhookPayload {
  const sessionId = randomUUID();
  const ref = reference ?? `trigger-wave-${sessionId}`;
  return {
    id: randomUUID(),
    type: outcome === "success" ? "checkout.session.completed" : "checkout.session.failed",
    data: {
      id: sessionId,
      client_reference: ref,
      payment_status: outcome === "success" ? "succeeded" : "cancelled",
      checkout_status: "complete",
    },
    occurredAt: new Date().toISOString(),
  };
}

export function buildOrangePayload(outcome: Outcome, reference?: string): OrangeWebhookPayload {
  const sessionId = randomUUID();
  const ref = reference ?? `trigger-orange-${sessionId}`;
  return {
    id: randomUUID(),
    transactionId: sessionId,
    reference: ref,
    status: outcome === "success" ? "SUCCESS" : "FAILED",
    timestamp: new Date().toISOString(),
  };
}

export function buildMtnPayload(outcome: Outcome, reference?: string): MtnWebhookPayload {
  const sessionId = randomUUID();
  const ref = reference ?? `trigger-mtn-${sessionId}`;
  return {
    id: randomUUID(),
    referenceId: sessionId,
    externalId: ref,
    status: outcome === "success" ? "SUCCESSFUL" : "FAILED",
    timestamp: new Date().toISOString(),
  };
}

export function buildProviderPayload(provider: Provider, outcome: Outcome): ProviderWebhookPayload {
  switch (provider) {
    case "wave": return buildWavePayload(outcome);
    case "orange": return buildOrangePayload(outcome);
    case "mtn": return buildMtnPayload(outcome);
  }
}

// ---------------------------------------------------------------------------
// Provider-specific header builders
// ---------------------------------------------------------------------------

export function buildProviderHeaders(
  provider: Provider,
  rawBody: string,
  secret: string
): Record<string, string> {
  const base = { "content-type": "application/json" };
  switch (provider) {
    case "wave": {
      // WaveProvider.isValidSignature strips "v1=" prefix and accepts bare hex
      const hmac = createHmac("sha256", secret).update(rawBody).digest("hex");
      return { ...base, "x-wave-signature": hmac };
    }
    case "orange":
      // OrangeMoneyProvider reads "x-api-key" and compares it directly to webhookApiKey
      return { ...base, "x-api-key": secret };
    case "mtn":
      // MtnMomoProvider reads "ocp-apim-subscription-key" and compares to subscriptionKey
      return { ...base, "ocp-apim-subscription-key": secret };
  }
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function triggerCommand(event: string, options: TriggerCommandOptions): Promise<void> {
  const parsed = parseEvent(event);
  const payload = buildProviderPayload(parsed.provider, parsed.outcome);
  const target = validateTarget(options.target);
  const rawBody = JSON.stringify(payload);
  const headers = buildProviderHeaders(parsed.provider, rawBody, options.secret);
  const startedAt = performance.now();

  try {
    const response = await fetch(target, { method: "POST", headers, body: rawBody });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const status = `${response.status} ${response.statusText}`.trim();
    console.log(`[${status}] ${event} envoyé à ${target.toString()} en ${elapsedMs} ms`);
    if (!response.ok) process.exitCode = 1;
  } catch (error: unknown) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const message = error instanceof Error ? error.message : "Unknown fetch error";
    console.error(`[ERROR] ${event} non envoyé à ${target.toString()} après ${elapsedMs} ms: ${message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const SUPPORTED_PROVIDERS = ["wave", "orange", "mtn"] as const;
export const SUPPORTED_OUTCOMES = ["success", "failed"] as const;

export function parseEvent(value: string): { provider: Provider; outcome: Outcome } {
  const match = value.match(/^(wave|orange|mtn)\.payment\.(success|failed)$/u);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(
      "Unsupported event. Format must be <provider>.payment.<success|failed> (e.g., wave.payment.success, orange.payment.success, mtn.payment.failed)."
    );
  }
  return { provider: match[1] as Provider, outcome: match[2] as Outcome };
}

function validateTarget(value: string): URL {
  const target = new URL(value);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("--target must use http or https.");
  }
  return target;
}
