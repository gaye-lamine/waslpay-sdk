import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

interface Payment { amount: number; reference: string; status: string; }

export function createProviderMocks() {
  const orange = new Map<string, Payment>();
  const wave = new Map<string, Payment>();
  const mtn = new Map<string, Payment>();

  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname;
    if (!path.startsWith("/mock/")) return false;
    const body = request.method === "GET" ? {} : await json(request);
    const send = (status: number, payload: object) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
        "access-control-allow-headers": "*",
      });
      response.end(JSON.stringify(payload));
    };
    if (path === "/mock/orange/oauth/v1/token" && request.method === "POST") { send(200, { access_token: "orange_mock_token", expires_in: 3600 }); return true; }
    if (path === "/mock/orange/v1/onlinePayment/prepare" && request.method === "POST") {
      const reference = string(body.reference) ?? randomUUID(); const amount = number(body.amount);
      orange.set(reference, { reference, amount, status: "PENDING" });
      send(200, { paymentUrl: `${origin(request)}/mock/orange/checkout/${reference}` }); return true;
    }
    if (path === "/mock/orange/api/eWallet/v1/transactions" && request.method === "GET") {
      const transaction = orange.get(url.searchParams.get("reference") ?? "");
      send(200, { transactions: transaction === undefined ? [] : [{ status: transaction.status }] }); return true;
    }
    if (path === "/mock/wave/checkout/sessions" && request.method === "POST") {
      const id = `wave_${randomUUID()}`; const reference = string(body.client_reference) ?? id; const amount = number(body.amount);
      wave.set(id, { reference, amount, status: "processing" });
      send(201, { id, wave_launch_url: `${origin(request)}/mock/wave/checkout/${id}` }); return true;
    }
    const waveMatch = path.match(/^\/mock\/wave\/checkout\/sessions\/([^/]+)(\/refund)?$/);
    if (waveMatch?.[1] !== undefined) {
      const payment = wave.get(decodeURIComponent(waveMatch[1]));
      if (payment === undefined) { send(404, { error_code: "not-found" }); return true; }
      if (waveMatch[2] === "/refund" && request.method === "POST") { send(200, { id: `refund_${randomUUID()}`, amount: body.amount ?? payment.amount, status: "succeeded" }); return true; }
      if (request.method === "GET") { send(200, { id: waveMatch[1], amount: payment.amount, client_reference: payment.reference, checkout_status: "open", payment_status: payment.status }); return true; }
    }
    if (path === "/mock/mtn/collection/token/" && request.method === "POST") { send(200, { access_token: "mtn_mock_token", expires_in: 3600 }); return true; }
    if (path === "/mock/mtn/collection/v1_0/requesttopay" && request.method === "POST") {
      const id = header(request, "x-reference-id") ?? randomUUID(); mtn.set(id, { reference: string(body.externalId) ?? id, amount: number(body.amount), status: "PENDING" }); send(202, {}); return true;
    }
    const mtnMatch = path.match(/^\/mock\/mtn\/collection\/v1_0\/requesttopay\/([^/]+)$/);
    if (mtnMatch?.[1] !== undefined && request.method === "GET") { const payment = mtn.get(decodeURIComponent(mtnMatch[1])); send(payment === undefined ? 404 : 200, payment === undefined ? { code: "RESOURCE_NOT_FOUND" } : { amount: String(payment.amount), externalId: payment.reference, status: payment.status }); return true; }
    if (path === "/mock/mtn/collection/v1_0/refund" && request.method === "POST") { send(202, {}); return true; }
    send(404, { message: "Mock endpoint not found" }); return true;
  };
}

async function json(request: IncomingMessage): Promise<Record<string, unknown>> { let raw = ""; for await (const chunk of request) raw += String(chunk); try { const parsed: unknown = JSON.parse(raw || "{}"); return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function number(value: unknown): number { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1000; }
function header(request: IncomingMessage, name: string): string | undefined { const value = request.headers[name]; return typeof value === "string" ? value : undefined; }
function origin(request: IncomingMessage): string { return `http://${header(request, "host") ?? "localhost"}`; }
