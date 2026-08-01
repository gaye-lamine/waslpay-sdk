import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OrangeMoneyProvider } from "../../core-node/src/providers/orange-money.js";
import { WaveProvider } from "../../core-node/src/providers/wave.js";
import { MtnMomoProvider } from "../../core-node/src/providers/mtn-momo.js";
import { PaymentStatus, type PaymentEvent } from "../../core-node/src/types.js";
import { triggerCommand } from "../src/commands/trigger.js";
import { DEV_MOCK_SECRETS } from "../src/generators/env.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        })
    )
  );
});

async function listenEphemeral(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected server address");
  return address.port;
}

describe("triggerCommand .failed events integration with core-node providers", () => {
  it("delivers wave.payment.failed to WaveProvider, yielding PaymentStatus.Failed and PaymentError", async () => {
    let receivedEvent: PaymentEvent | undefined;
    const provider = new WaveProvider({
      apiKey: "mock_api_key",
      webhookSecret: DEV_MOCK_SECRETS.wave,
    });

    const server = createServer(async (req, res) => {
      let rawBody = "";
      for await (const chunk of req) {
        rawBody += chunk.toString("utf8");
      }
      try {
        receivedEvent = await provider.handleWebhook(rawBody, req.headers as Record<string, string>);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ eventId: receivedEvent.id }));
      } catch (err: any) {
        res.writeHead(400);
        res.end(err.message);
      }
    });

    servers.push(server);
    const port = await listenEphemeral(server);

    await triggerCommand("wave.payment.failed", {
      target: `http://127.0.0.1:${port}/webhooks/waslpay/wave`,
    });

    expect(receivedEvent).toBeDefined();
    expect(receivedEvent?.status).toBe(PaymentStatus.Failed);
    expect(receivedEvent?.error).toBeDefined();
  });

  it("delivers orange.payment.failed to OrangeMoneyProvider, yielding PaymentStatus.Failed and PaymentError", async () => {
    let receivedEvent: PaymentEvent | undefined;
    const provider = new OrangeMoneyProvider({
      clientId: "mock_client",
      clientSecret: "mock_secret",
      merchantCode: "mock_merchant",
      sitename: "mock_site",
      callbackUrl: "http://localhost/callback",
      webhookApiKey: DEV_MOCK_SECRETS.orange,
      environment: "sandbox",
    });

    const server = createServer(async (req, res) => {
      let rawBody = "";
      for await (const chunk of req) {
        rawBody += chunk.toString("utf8");
      }
      try {
        receivedEvent = await provider.handleWebhook(rawBody, req.headers as Record<string, string>);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ eventId: receivedEvent.id }));
      } catch (err: any) {
        res.writeHead(400);
        res.end(err.message);
      }
    });

    servers.push(server);
    const port = await listenEphemeral(server);

    await triggerCommand("orange.payment.failed", {
      target: `http://127.0.0.1:${port}/webhooks/waslpay/orange`,
    });

    expect(receivedEvent).toBeDefined();
    expect(receivedEvent?.status).toBe(PaymentStatus.Failed);
    expect(receivedEvent?.error).toBeDefined();
  });

  it("delivers mtn.payment.failed to MtnMomoProvider, yielding PaymentStatus.Failed and PaymentError", async () => {
    let receivedEvent: PaymentEvent | undefined;
    const provider = new MtnMomoProvider({
      subscriptionKey: DEV_MOCK_SECRETS.mtn,
      apiUser: "00000000-0000-4000-8000-000000000001",
      apiKey: "mock_key",
      targetEnvironment: "sandbox",
      defaultCurrency: "XOF",
    });

    const server = createServer(async (req, res) => {
      let rawBody = "";
      for await (const chunk of req) {
        rawBody += chunk.toString("utf8");
      }
      try {
        receivedEvent = await provider.handleWebhook(rawBody, req.headers as Record<string, string>);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ eventId: receivedEvent.id }));
      } catch (err: any) {
        res.writeHead(400);
        res.end(err.message);
      }
    });

    servers.push(server);
    const port = await listenEphemeral(server);

    await triggerCommand("mtn.payment.failed", {
      target: `http://127.0.0.1:${port}/webhooks/waslpay/mtn`,
    });

    expect(receivedEvent).toBeDefined();
    expect(receivedEvent?.status).toBe(PaymentStatus.Failed);
    expect(receivedEvent?.error).toBeDefined();
  });
});
