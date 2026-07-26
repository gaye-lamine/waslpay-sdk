import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createDevServer, parsePort } from "../src/commands/dev.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("parsePort", () => {
  it.each([
    ["0", 0],
    ["1", 1],
    ["4004", 4004],
    ["65535", 65535],
  ])("parses %s as %i", (value, expected) => {
    expect(parsePort(value)).toBe(expected);
  });

  it.each(["", "-1", "65536", "4004.5", "not-a-number", "Infinity"])
  ("rejects invalid port %s", (value) => {
    expect(() => parsePort(value)).toThrow("--port must be an integer between 0 and 65535.");
  });

  it("rejects an absent port at runtime", () => {
    expect(() => parsePort(undefined as unknown as string)).toThrow("--port must be an integer between 0 and 65535.");
  });
});

describe("createDevServer", () => {
  it("creates a checkout session on an ephemeral port", async () => {
    const server = createDevServer("http://127.0.0.1:65534/webhooks/waslpay");
    servers.push(server);
    const port = await listenOnEphemeralPort(server);

    const response = await fetch(`http://127.0.0.1:${port}/v1/checkout/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_reference: "order-123" }),
    });
    const payload = await response.json() as { id: string; checkout_url: string };

    expect(response.status).toBe(201);
    expect(payload.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(payload.checkout_url).toBe(`http://localhost:${port}/checkout/${payload.id}`);
  });

  it("delivers a HMAC-signed completed-payment webhook to an ephemeral receiver", async () => {
    let received: { rawBody: string; headers: IncomingHttpHeaders } | undefined;
    const receiver = createServer(async (request, response) => {
      let rawBody = "";
      for await (const chunk of request) {
        rawBody += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      }
      received = { rawBody, headers: request.headers };
      response.writeHead(204);
      response.end();
    });
    servers.push(receiver);
    const receiverPort = await listenOnEphemeralPort(receiver);

    const server = createDevServer(`http://127.0.0.1:${receiverPort}/webhooks/waslpay`);
    servers.push(server);
    const port = await listenOnEphemeralPort(server);

    const checkoutResponse = await fetch(`http://127.0.0.1:${port}/v1/checkout/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference: "order-456" }),
    });
    const checkout = await checkoutResponse.json() as { id: string };

    const simulationResponse = await fetch(`http://127.0.0.1:${port}/checkout/${checkout.id}/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ result: "success" }),
    });

    expect(simulationResponse.status).toBe(200);
    expect(received).toBeDefined();
    if (received === undefined) throw new Error("Expected the webhook receiver to receive a request.");

    const expectedSignature = createHmac("sha256", "mock_wave_webhook_secret").update(received.rawBody).digest("hex");
    const event = JSON.parse(received.rawBody) as { data?: { id: string; client_reference?: string }; type?: string };

    expect(received.headers["x-wave-signature"]).toBe(expectedSignature);
    expect(event.type).toBe("checkout.session.completed");
    expect(event.data).toMatchObject({ id: checkout.id, client_reference: "order-456" });
  });
});

async function listenOnEphemeralPort(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an IPv4 server address.");
  }
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
