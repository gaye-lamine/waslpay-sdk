import { describe, expect, it } from "vitest";
import {
  buildWavePayload,
  buildOrangePayload,
  buildMtnPayload,
  buildProviderHeaders,
} from "../src/commands/trigger.js";

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
    });

    await expect(provider.handleWebhook(rawBody, badHeaders)).rejects.toThrow("Invalid MTN MoMo webhook security key");
  });
});

