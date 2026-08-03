import type { Provider } from "../env.js";

export type NodeFramework = "express" | "fastify" | "nestjs";

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/** "orange-money" → "orangeMoney", "mtn-momo" → "mtnMomo", "wave" → "wave" */
function jsVarName(provider: Provider): string {
  return provider.replace(/-([a-z])/gu, (_, c: string) => c.toUpperCase());
}

function jsClassName(provider: Provider): string {
  switch (provider) {
    case "orange-money": return "OrangeMoneyProvider";
    case "mtn-momo": return "MtnMomoProvider";
    case "wave": return "WaveProvider";
  }
}

/** Route slug: "orange-money" → "/checkout/orange-money" */
function checkoutPath(provider: Provider, multi: boolean): string {
  return multi ? `/checkout/${provider}` : "/checkout";
}

function webhookPath(provider: Provider, multi: boolean): string {
  return multi ? `/api/webhooks/waslpay/${provider}` : "/api/webhooks/waslpay";
}

function refundPath(provider: Provider, multi: boolean): string {
  return multi ? `/refund/${provider}/:sessionId` : "/refund/:sessionId";
}

// ---------------------------------------------------------------------------
// Provider instantiation snippets
// ---------------------------------------------------------------------------

function jsProviderConfig(provider: Provider, multi: boolean): string {
  switch (provider) {
    case "orange-money":
      return `{\n  clientId: process.env.ORANGE_MONEY_CLIENT_ID || '',\n  clientSecret: process.env.ORANGE_MONEY_CLIENT_SECRET || '',\n  merchantCode: process.env.ORANGE_MONEY_MERCHANT_CODE || '',\n  sitename: process.env.ORANGE_MONEY_SITENAME || '',\n  callbackUrl: process.env.ORANGE_MONEY_CALLBACK_URL || 'http://localhost:8000${webhookPath("orange-money", multi)}',\n  webhookApiKey: process.env.ORANGE_MONEY_WEBHOOK_API_KEY || '',\n  environment: process.env.ORANGE_MONEY_ENVIRONMENT || 'sandbox',\n  baseUrl: process.env.ORANGE_MONEY_BASE_URL,\n}`;
    case "mtn-momo":
      return `{\n  subscriptionKey: process.env.MTN_MOMO_SUBSCRIPTION_KEY || '',\n  apiUser: process.env.MTN_MOMO_API_USER || '',\n  apiKey: process.env.MTN_MOMO_API_KEY || '',\n  targetEnvironment: process.env.MTN_MOMO_TARGET_ENVIRONMENT || 'sandbox',\n  baseUrl: process.env.MTN_MOMO_BASE_URL,\n}`;
    case "wave":
      return `{\n  apiKey: process.env.WAVE_API_KEY || '',\n  webhookSecret: process.env.WAVE_WEBHOOK_SECRET || '',\n  baseUrl: process.env.WAVE_BASE_URL,\n}`;
  }
}

/** Single provider block: "const provider = new WaveProvider({...})\nconst waslpay = new WaslPay(provider);" */
function singleProviderBlock(provider: Provider): string {
  const cls = jsClassName(provider);
  const cfg = jsProviderConfig(provider, false);
  return `const provider = new ${cls}(${cfg});\nconst waslpay = new WaslPay(provider);`;
}

/**
 * Multi-provider block: one instantiation per provider.
 * Returns: { instantiations: string; importClasses: string[] }
 */
function multiProviderBlock(providers: readonly Provider[]): { instantiations: string; importClasses: string[] } {
  const importClasses: string[] = [];
  const blocks: string[] = [];
  for (const p of providers) {
    const v = jsVarName(p);
    const cls = jsClassName(p);
    const cfg = jsProviderConfig(p, true);
    importClasses.push(cls);
    blocks.push(`const ${v}Provider = new ${cls}(${cfg});\nconst waslpay${v.charAt(0).toUpperCase()}${v.slice(1)} = new WaslPay(${v}Provider);`);
  }
  return { instantiations: blocks.join("\n\n"), importClasses };
}

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------

function expressRoutes(providers: readonly Provider[], multi: boolean): string {
  if (!multi) {
    const p = providers[0] ?? "wave";
    return `
app.post('${checkoutPath(p, false)}', express.json(), async (req, res) => {
  try {
    const session = await waslpay.initiatePayment({
      amount: 1000,
      currency: 'XOF',
      reference: 'order-123',
      customerPhone: '+221770000000',
    });
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: (err && typeof err === 'object' && 'message' in err) ? err.message : String(err) });
  }
});

app.post('${webhookPath(p, false)}', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await waslpay.handleWebhook(req.body, req.headers);
    res.json({ eventId: event.id });
  } catch (err) {
    res.status(400).send((err && typeof err === 'object' && 'message' in err) ? String(err.message) : String(err));
  }
});

app.post('${refundPath(p, false)}', express.json(), async (req, res) => {
  try {
    const result = await waslpay.refund(req.params.sessionId, 1000);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err && typeof err === 'object' && 'message' in err) ? err.message : String(err) });
  }
});`;
  }

  const lines: string[] = [];
  for (const p of providers) {
    const v = jsVarName(p);
    const waslpayVar = `waslpay${v.charAt(0).toUpperCase()}${v.slice(1)}`;
    lines.push(`
app.post('${checkoutPath(p, true)}', express.json(), async (req, res) => {
  try {
    const session = await ${waslpayVar}.initiatePayment({
      amount: 1000, currency: 'XOF', reference: 'order-123', customerPhone: '+221770000000',
    });
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: (err && typeof err === 'object' && 'message' in err) ? err.message : String(err) });
  }
});

app.post('${webhookPath(p, true)}', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await ${waslpayVar}.handleWebhook(req.body, req.headers);
    res.json({ eventId: event.id });
  } catch (err) {
    res.status(400).send((err && typeof err === 'object' && 'message' in err) ? String(err.message) : String(err));
  }
});

app.post('${refundPath(p, true)}', express.json(), async (req, res) => {
  try {
    const result = await ${waslpayVar}.refund(req.params.sessionId, 1000);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err && typeof err === 'object' && 'message' in err) ? err.message : String(err) });
  }
});`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Fastify
// ---------------------------------------------------------------------------

function fastifyRoutes(providers: readonly Provider[], multi: boolean): string {
  if (!multi) {
    const p = providers[0] ?? "wave";
    return `
fastify.post('${checkoutPath(p, false)}', async (request, reply) => {
  const session = await waslpay.initiatePayment({
    amount: 1000, currency: 'XOF', reference: 'order-123', customerPhone: '+221770000000',
  });
  return session;
});

fastify.post('${webhookPath(p, false)}', async (request, reply) => {
  const rawBody = request.rawBody || request.body;
  const event = await waslpay.handleWebhook(rawBody, request.headers);
  return { eventId: event.id };
});

fastify.post('${refundPath(p, false)}', async (request, reply) => {
  const { sessionId } = request.params;
  const result = await waslpay.refund(sessionId, 1000);
  return result;
});`;
  }

  const lines: string[] = [];
  for (const p of providers) {
    const v = jsVarName(p);
    const waslpayVar = `waslpay${v.charAt(0).toUpperCase()}${v.slice(1)}`;
    lines.push(`
fastify.post('${checkoutPath(p, true)}', async (request, reply) => {
  const session = await ${waslpayVar}.initiatePayment({
    amount: 1000, currency: 'XOF', reference: 'order-123', customerPhone: '+221770000000',
  });
  return session;
});

fastify.post('${webhookPath(p, true)}', async (request, reply) => {
  const rawBody = request.rawBody || request.body;
  const event = await ${waslpayVar}.handleWebhook(rawBody, request.headers);
  return { eventId: event.id };
});

fastify.post('${refundPath(p, true)}', async (request, reply) => {
  const { sessionId } = request.params;
  const result = await ${waslpayVar}.refund(sessionId, 1000);
  return result;
});`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// NestJS
// ---------------------------------------------------------------------------

function nestJsMethods(providers: readonly Provider[], multi: boolean): string {
  if (!multi) {
    const p = providers[0] ?? "wave";
    return `  @Post('${checkoutPath(p, false).replace("/", "")}')
  async createCheckout() {
    return await waslpay.initiatePayment({
      amount: 1000, currency: 'XOF', reference: 'order-123', customerPhone: '+221770000000',
    });
  }

  @Post('${webhookPath(p, false).replace("/api/webhooks/", "webhooks/")}')
  async handleWebhookPost(@Req() req, @Res() res) {
    const event = await waslpay.handleWebhook(req.body, req.headers);
    return res.status(HttpStatus.OK).json({ eventId: event.id });
  }

  @Post('${refundPath(p, false).slice(1)}')
  async refund(@Param('sessionId') sessionId) {
    return await waslpay.refund(sessionId, 1000);
  }`;
  }

  const methods: string[] = [];
  for (const p of providers) {
    const v = jsVarName(p);
    const waslpayVar = `waslpay${v.charAt(0).toUpperCase()}${v.slice(1)}`;
    const methodSuffix = v.charAt(0).toUpperCase() + v.slice(1);
    methods.push(`  @Post('${checkoutPath(p, true).slice(1)}')
  async createCheckout${methodSuffix}() {
    return await ${waslpayVar}.initiatePayment({
      amount: 1000, currency: 'XOF', reference: 'order-123', customerPhone: '+221770000000',
    });
  }

  @Post('${webhookPath(p, true).slice(1)}')
  async handleWebhook${methodSuffix}(@Req() req, @Res() res) {
    const event = await ${waslpayVar}.handleWebhook(req.body, req.headers);
    return res.status(HttpStatus.OK).json({ eventId: event.id });
  }

  @Post('${refundPath(p, true).slice(1)}')
  async refund${methodSuffix}(@Param('sessionId') sessionId) {
    return await ${waslpayVar}.refund(sessionId, 1000);
  }`);
  }
  return methods.join("\n\n");
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generateNodeBoilerplate(framework: NodeFramework, providers: readonly Provider[]): string {
  const multi = providers.length > 1;
  const header = `// Generated for ${framework}. Selected providers: ${providers.join(", ")}`;

  if (framework === "fastify") {
    if (!multi) {
      const p = providers[0] ?? "wave";
      const cls = jsClassName(p);
      const block = singleProviderBlock(p);
      return `${header}
import Fastify from 'fastify';
import { WaslPay, ${cls} } from '@waslpay/core-node';
import { config } from 'dotenv';
config({ path: '.env.waslpay.example' });

const fastify = Fastify({ logger: true });

${block}
${fastifyRoutes(providers, false)}

const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
`;
    }
    const { instantiations, importClasses } = multiProviderBlock(providers);
    return `${header}
import Fastify from 'fastify';
import { WaslPay, ${importClasses.join(", ")} } from '@waslpay/core-node';
import { config } from 'dotenv';
config({ path: '.env.waslpay.example' });

const fastify = Fastify({ logger: true });

${instantiations}
${fastifyRoutes(providers, true)}

const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
`;
  }

  if (framework === "nestjs") {
    if (!multi) {
      const p = providers[0] ?? "wave";
      const cls = jsClassName(p);
      const block = singleProviderBlock(p);
      return `${header}
import { Controller, Post, Req, Res, HttpStatus, Param } from '@nestjs/common';
import { WaslPay, ${cls} } from '@waslpay/core-node';
import { config } from 'dotenv';
config({ path: '.env.waslpay.example' });

${block}

@Controller()
export class PaymentController {
${nestJsMethods(providers, false)}
}
`;
    }
    const { instantiations, importClasses } = multiProviderBlock(providers);
    return `${header}
import { Controller, Post, Req, Res, HttpStatus, Param } from '@nestjs/common';
import { WaslPay, ${importClasses.join(", ")} } from '@waslpay/core-node';
import { config } from 'dotenv';
config({ path: '.env.waslpay.example' });

${instantiations}

@Controller()
export class PaymentController {
${nestJsMethods(providers, true)}
}
`;
  }

  // Express (default)
  if (!multi) {
    const p = providers[0] ?? "wave";
    const cls = jsClassName(p);
    const block = singleProviderBlock(p);
    return `${header}
import express from 'express';
import { WaslPay, ${cls} } from '@waslpay/core-node';
import { config } from 'dotenv';
config({ path: '.env.waslpay.example' });

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

${block}
${expressRoutes(providers, false)}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(\`Server listening on port \${port}\`);
});
`;
  }
  const { instantiations, importClasses } = multiProviderBlock(providers);
  return `${header}
import express from 'express';
import { WaslPay, ${importClasses.join(", ")} } from '@waslpay/core-node';
import { config } from 'dotenv';
config({ path: '.env.waslpay.example' });

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

${instantiations}
${expressRoutes(providers, true)}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(\`Server listening on port \${port}\`);
});
`;
}
