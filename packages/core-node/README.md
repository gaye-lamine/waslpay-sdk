# WaslPay Core Node

SDK TypeScript strict pour les paiements Orange Money, Wave et MTN MoMo.

## Installation

```bash
npm install @waslpay/core-node
# ou
pnpm add @waslpay/core-node
# ou
yarn add @waslpay/core-node
```

## Configuration et initialisation

Créez un adaptateur pour le provider choisi, puis injectez-le dans `WaslPay`.

```ts
import { WaslPay } from "@waslpay/core-node";
import { WaveProvider } from "@waslpay/core-node/providers/wave";

const provider = new WaveProvider({
  apiKey: process.env.WAVE_API_KEY!,
  webhookSecret: process.env.WAVE_WEBHOOK_SECRET!,
});

const waslpay = new WaslPay(provider);
```

Variables `.env` :

```dotenv
# Orange Money Sénégal
ORANGE_MONEY_CLIENT_ID=
ORANGE_MONEY_CLIENT_SECRET=
ORANGE_MONEY_MERCHANT_CODE=
ORANGE_MONEY_SITENAME=
ORANGE_MONEY_CALLBACK_URL=
ORANGE_MONEY_WEBHOOK_API_KEY=
ORANGE_MONEY_ENVIRONMENT=sandbox

# Wave Sénégal
WAVE_API_KEY=
WAVE_WEBHOOK_SECRET=

# MTN MoMo Collection
MTN_MOMO_SUBSCRIPTION_KEY=
MTN_MOMO_API_USER=
MTN_MOMO_API_KEY=
MTN_MOMO_TARGET_ENVIRONMENT=sandbox
MTN_MOMO_DEFAULT_CURRENCY=XOF
```

Pour Orange Money, construisez `OrangeMoneyProvider` avec `clientId`, `clientSecret`, `merchantCode`, `sitename`, `callbackUrl`, `webhookApiKey` et `environment`. Pour MTN, construisez `MtnMomoProvider` avec `subscriptionKey`, `apiUser`, `apiKey`, `targetEnvironment` et `defaultCurrency`.

## Flux de paiement complet

```ts
import express from "express";

const app = express();

/**
 * Initialisation d'une nouvelle session de paiement.
 */
const session = await waslpay.initiatePayment({
  amount: 1_000,
  currency: "XOF",
  reference: "order-123",
  customerPhone: "+221770000000",
  successUrl: "https://merchant.example/payments/success",
  failureUrl: "https://merchant.example/payments/failed",
});

/**
 * Interrogation et vérification du statut courant de la session.
 */
const status = await waslpay.checkStatus(session.id);

/**
 * Endpoint de traitement du webhook sur le corps HTTP brut (raw body).
 */
app.post("/webhooks/payments", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const event = await waslpay.handleWebhook(req.body, req.headers);
    res.sendStatus(204);
  } catch {
    res.sendStatus(401);
  }
});

/**
 * Remboursement partiel ou total de la transaction.
 */
const refund = await waslpay.refund(session.id, 500);
```

## Erreurs normalisées

| PaymentError | Orange Money | Wave | MTN MoMo |
| --- | --- | --- | --- |
| `INSUFFICIENT_FUNDS` | Codes Sonatel `2020`, `2021` | `insufficient-funds` | `NOT_ENOUGH_FUNDS` |
| `PROVIDER_TIMEOUT` | Codes techniques Sonatel | HTTP 5xx ou timeout | HTTP 5xx ou timeout |
| `INVALID_PHONE` | Codes `2000`, `2001` | `payer-mobile-mismatch` | Validation MSISDN/provider |
| `USER_CANCELLED` | Annulation du payeur | Paiement annulé | `APPROVAL_REJECTED`, `EXPIRED` |
| `UNKNOWN` | Toute autre réponse | Toute autre réponse | Toute autre réponse |

Les erreurs adapter sont rejetées avec leur code `PaymentError`. Ne confirmez jamais une commande sur un timeout : vérifiez ensuite le statut du provider.

## Tester sans clés API

Lancez `waslpay dev`, puis construisez le vrai `WaveProvider` avec des clés non vides
et `baseUrl: "http://localhost:4004/mock/wave"`. En production, retirez seulement
`baseUrl` et remplacez les valeurs d'environnement.

## Tests

```bash
npm test
# ou
pnpm test
```

Les tests Vitest incluent les scénarios de contrat pour Orange Money, Wave et MTN MoMo.
