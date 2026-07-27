import { describe, expect, it } from "vitest";
import {
  buildWavePayload,
  buildOrangePayload,
  buildMtnPayload,
  buildProviderHeaders,
  buildProviderPayload,
  parseEvent,
} from "../src/commands/trigger.js";
import { DEV_MOCK_SECRETS } from "../src/generators/env.js";

import { WaveProvider } from "../../core-node/src/providers/wave.js";
import { OrangeMoneyProvider } from "../../core-node/src/providers/orange-money.js";
import { MtnMomoProvider } from "../../core-node/src/providers/mtn-momo.js";
import { PaymentStatus } from "../../core-node/src/types.js";

describe("buildProviderPayload and headers contract test", () => {
  it("Wave webhook contract validates successfully", async () => {
    const secret = "mock_wave_secret";
    const payload = buildWavePayload("success", "order-wave-123");
    const rawBody = JSON.stringify(payload);
    const headers = buildProviderHeaders("wave", rawBody, secret);

    const provider = new WaveProvider({
      apiKey: "mock",
      webhookSecret: secret,
    });

    const event = await provider.handleWebhook(rawBody, headers);
    expect(event.sessionId).toBe(payload.data.id);
    expect(event.reference).toBe("order-wave-123");
    expect(event.status).toBe(PaymentStatus.Success);
  });

  it("Wave webhook contract rejects invalid signature", async () => {
    const secret = "mock_wave_secret";
    const payload = buildWavePayload("success", "order-wave-123");
    const rawBody = JSON.stringify(payload);
    const badHeaders = buildProviderHeaders("wave", rawBody, "wrong_secret");

    const provider = new WaveProvider({
      apiKey: "mock",
      webhookSecret: secret,
    });

    await expect(provider.handleWebhook(rawBody, badHeaders)).rejects.toThrow("Invalid Wave webhook signature");
  });

  it("Orange Money webhook contract validates successfully", async () => {
    const secret = "mock_orange_secret";
    const payload = buildOrangePayload("success", "order-orange-123");
    const rawBody = JSON.stringify(payload);
    const headers = buildProviderHeaders("orange", rawBody, secret);

    const provider = new OrangeMoneyProvider({
      clientId: "mock",
      clientSecret: "mock",
      merchantCode: "mock",
      sitename: "mock",
      callbackUrl: "mock",
      webhookApiKey: secret,
      environment: "sandbox",
    });

    const event = await provider.handleWebhook(rawBody, headers);
    expect(event.sessionId).toBe(payload.reference);
    expect(event.reference).toBe("order-orange-123");
    expect(event.status).toBe(PaymentStatus.Success);
  });

  it("Orange Money webhook contract rejects invalid API key", async () => {
    const secret = "mock_orange_secret";
    const payload = buildOrangePayload("success", "order-orange-123");
    const rawBody = JSON.stringify(payload);
    const badHeaders = buildProviderHeaders("orange", rawBody, "wrong_secret");

    const provider = new OrangeMoneyProvider({
      clientId: "mock",
      clientSecret: "mock",
      merchantCode: "mock",
      sitename: "mock",
      callbackUrl: "mock",
      webhookApiKey: secret,
      environment: "sandbox",
    });

    await expect(provider.handleWebhook(rawBody, badHeaders)).rejects.toThrow("Invalid Orange Money webhook API key");
  });

  it("MTN MoMo webhook contract validates successfully", async () => {
    const secret = "mock_mtn_secret";
    const payload = buildMtnPayload("success", "order-mtn-123");
    const rawBody = JSON.stringify(payload);
    const headers = buildProviderHeaders("mtn", rawBody, secret);

    const provider = new MtnMomoProvider({
      subscriptionKey: secret,
      apiUser: "00000000-0000-4000-8000-000000000001",
      apiKey: "mock",
      targetEnvironment: "sandbox",
      defaultCurrency: "XOF",
    });

    const event = await provider.handleWebhook(rawBody, headers);
    expect(event.sessionId).toBe(payload.referenceId);
    expect(event.reference).toBe("order-mtn-123");
    expect(event.status).toBe(PaymentStatus.Success);
  });

  it("MTN MoMo webhook contract rejects invalid subscription key", async () => {
    const secret = "mock_mtn_secret";
    const payload = buildMtnPayload("success", "order-mtn-123");
    const rawBody = JSON.stringify(payload);
    const badHeaders = buildProviderHeaders("mtn", rawBody, "wrong_secret");

    const provider = new MtnMomoProvider({
      subscriptionKey: secret,
      apiUser: "00000000-0000-4000-8000-000000000001",
      apiKey: "mock",
      targetEnvironment: "sandbox",
      defaultCurrency: "XOF",
    });

    await expect(provider.handleWebhook(rawBody, badHeaders)).rejects.toThrow("Invalid MTN MoMo webhook security key");
  });
});

describe("parseEvent - 3x2 event matrix validation", () => {
  const providers = ["wave", "orange", "mtn"] as const;
  const outcomes = ["success", "failed"] as const;

  it.each(
    providers.flatMap((provider) =>
      outcomes.map((outcome) => [provider, outcome] as const)
    )
  )("parses %s.payment.%s correctly and builds a valid payload", (provider, outcome) => {
    const eventName = `${provider}.payment.${outcome}`;
    const parsed = parseEvent(eventName);

    expect(parsed.provider).toBe(provider);
    expect(parsed.outcome).toBe(outcome);

    const payload = buildProviderPayload(parsed.provider, parsed.outcome);
    expect(payload).toBeDefined();
    expect(payload.id).toBeDefined();
  });

  it("accepts all 6 events in the 3x2 matrix (wave, orange, mtn x success, failed)", () => {
    const expectedEvents = [
      "wave.payment.success",
      "wave.payment.failed",
      "orange.payment.success",
      "orange.payment.failed",
      "mtn.payment.success",
      "mtn.payment.failed",
    ];

    for (const evt of expectedEvents) {
      expect(() => parseEvent(evt)).not.toThrow();
    }
  });

  it("rejects invalid event strings", () => {
    expect(() => parseEvent("invalid.event")).toThrow("Unsupported event");
    expect(() => parseEvent("wave.payment.unknown")).toThrow("Unsupported event");
    expect(() => parseEvent("orange.checkout.success")).toThrow("Unsupported event");
  });

  it("buildProviderHeaders defaults to DEV_MOCK_SECRETS exact values per provider", () => {
    const waveHeaders = buildProviderHeaders("wave", "{}", DEV_MOCK_SECRETS.wave);
    expect(waveHeaders["x-wave-signature"]).toBeDefined();

    const orangeHeaders = buildProviderHeaders("orange", "{}", DEV_MOCK_SECRETS.orange);
    expect(orangeHeaders["x-api-key"]).toBe("mock_orange_api_key");
    expect(orangeHeaders["x-api-key"]).toBe(DEV_MOCK_SECRETS.orange);

    const mtnHeaders = buildProviderHeaders("mtn", "{}", DEV_MOCK_SECRETS.mtn);
    expect(mtnHeaders["ocp-apim-subscription-key"]).toBe("mock_mtn_subscription");
    expect(mtnHeaders["ocp-apim-subscription-key"]).toBe(DEV_MOCK_SECRETS.mtn);
  });
});

