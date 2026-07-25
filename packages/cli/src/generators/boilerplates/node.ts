import type { Provider } from "../env.js";

export type NodeFramework = "express" | "fastify" | "nestjs";

function getProviderCodeNode(provider: Provider): { importClass: string; code: string } {
  switch (provider) {
    case "orange-money":
      return {
        importClass: "OrangeMoneyProvider",
        code: `const provider = new OrangeMoneyProvider({
  authHeader: process.env.ORANGE_MONEY_AUTH_HEADER || '',
  merchantKey: process.env.ORANGE_MONEY_MERCHANT_KEY || '',
  baseUrl: process.env.ORANGE_MONEY_BASE_URL,
});`,
      };
    case "mtn-momo":
      return {
        importClass: "MtnMomoProvider",
        code: `const provider = new MtnMomoProvider({
  subscriptionKey: process.env.MTN_MOMO_SUBSCRIPTION_KEY || '',
  apiUser: process.env.MTN_MOMO_API_USER || '',
  apiKey: process.env.MTN_MOMO_API_KEY || '',
  targetEnvironment: process.env.MTN_MOMO_TARGET_ENVIRONMENT || 'sandbox',
  baseUrl: process.env.MTN_MOMO_BASE_URL,
});`,
      };
    case "wave":
    default:
      return {
        importClass: "WaveProvider",
        code: `const provider = new WaveProvider({
  apiKey: process.env.WAVE_API_KEY || '',
  webhookSecret: process.env.WAVE_WEBHOOK_SECRET || '',
  baseUrl: process.env.WAVE_BASE_URL,
});`,
      };
  }
}

export function generateNodeBoilerplate(framework: NodeFramework, providers: readonly Provider[]): string {
  const primaryProvider = providers[0] ?? "wave";
  const { importClass, code } = getProviderCodeNode(primaryProvider);

  if (framework === "fastify") {
    return `// Generated for ${framework}. Selected providers: ${providers.join(", ")}
import Fastify from 'fastify';
import { WaslPay, ${importClass} } from '@waslpay/core-node';

const fastify = Fastify({ logger: true });

${code}
const waslpay = new WaslPay(provider);

fastify.post('/checkout', async (request, reply) => {
  const session = await waslpay.initiatePayment({
    amount: 1000,
    currency: 'XOF',
    reference: 'order-123',
    customerPhone: '+221770000000',
  });
  return session;
});

fastify.post('/api/webhooks/waslpay', async (request, reply) => {
  const rawBody = request.rawBody || request.body;
  const event = await waslpay.handleWebhook(rawBody, request.headers);
  return { eventId: event.id };
});

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
    return `// Generated for ${framework}. Selected providers: ${providers.join(", ")}
import { Controller, Post, Req, Res, HttpStatus } from '@nestjs/common';
import { WaslPay, ${importClass} } from '@waslpay/core-node';

${code}
const waslpay = new WaslPay(provider);

@Controller('api/webhooks')
export class PaymentController {
  @Post('checkout')
  async createCheckout() {
    return await waslpay.initiatePayment({
      amount: 1000,
      currency: 'XOF',
      reference: 'order-123',
      customerPhone: '+221770000000',
    });
  }

  @Post('waslpay')
  async handleWebhook(@Req() req, @Res() res) {
    const event = await waslpay.handleWebhook(req.body, req.headers);
    return res.status(HttpStatus.OK).json({ eventId: event.id });
  }
}
`;
  }

  // Express
  return `// Generated for ${framework}. Selected providers: ${providers.join(", ")}
import express from 'express';
import { WaslPay, ${importClass} } from '@waslpay/core-node';

const app = express();

${code}
const waslpay = new WaslPay(provider);

app.post('/checkout', async (req, res) => {
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

app.post('/api/webhooks/waslpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await waslpay.handleWebhook(req.body, req.headers);
    res.json({ eventId: event.id });
  } catch (err) {
    res.status(400).send((err && typeof err === 'object' && 'message' in err) ? String(err.message) : String(err));
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(\`Server listening on port \${port}\`);
});
`;
}
