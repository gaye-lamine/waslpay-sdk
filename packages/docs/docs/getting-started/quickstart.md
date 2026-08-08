---
sidebar_position: 1
---

# Quickstart

Ce parcours Node.js crée une session Wave, lit son `PaymentStatusResult`, valide
un webhook signé et exécute un remboursement. Il a été exécuté contre le mock
local WaslPay avec les vraies classes du SDK.

## 1. Installer le SDK

```bash
npm install @waslpay/core-node
```

Vous pouvez aussi utiliser `pnpm add @waslpay/core-node` ou
`yarn add @waslpay/core-node`.

## 2. Configurer Wave

En production, renseignez vos propres identifiants marchands Wave dans votre
fichier `.env` :

```dotenv
WAVE_API_KEY=wave_sn_prod_votre_cle_marchande
WAVE_WEBHOOK_SECRET=votre_secret_webhook_wave
```

Pour suivre ce guide sans clé API, installez la CLI globalement ou utilisez `npx` :

```bash
npm install -g @waslpay/cli
wasl init --language node --framework express --providers wave --mock
wasl dev

# Ou sans installation globale :
# npx @waslpay/cli init --language node --framework express --providers wave --mock
# npx @waslpay/cli dev
```

Le générateur crée les variables `WAVE_API_KEY=mock_wave_key`,
`WAVE_WEBHOOK_SECRET=mock_wave_webhook` et
`WAVE_BASE_URL=http://localhost:4004/mock/wave`. Le mode mock est détaillé dans
le guide [Tester sans clés API](./testing-without-api-keys).

## 3. Exécuter le flux complet

Créez un fichier `quickstart.mjs`, chargez votre `.env`, puis exécutez-le avec
Node.js pendant que `waslpay dev` tourne dans un autre terminal.

```ts
import { createHmac } from "node:crypto";

import { WaslPay, WaveProvider } from "@waslpay/core-node";

const provider = new WaveProvider({
  apiKey: process.env.WAVE_API_KEY!,
  webhookSecret: process.env.WAVE_WEBHOOK_SECRET!,
  // Absente en production : le provider utilise alors https://api.wave.com/v1.
  baseUrl: process.env.WAVE_BASE_URL,
});
const waslPay = new WaslPay(provider);

// 1. Créer une session de paiement.
const session = await waslPay.initiatePayment({
  amount: 1000,
  currency: "XOF",
  reference: "quickstart-order-123",
  customerPhone: "+221770000000",
  successUrl: "http://localhost/success",
  failureUrl: "http://localhost/failure",
});

// 2. Lire un PaymentStatusResult, et non un statut nu.
const statusResult = await waslPay.checkStatus(session.id);
if (statusResult.status === "failed") {
  console.error(statusResult.error);
}

// 3. Le webhook doit être vérifié sur le body brut exact.
const rawWebhook = JSON.stringify({
  id: "quickstart-event-1",
  type: "checkout.session.completed",
  data: {
    id: session.id,
    client_reference: session.reference,
    payment_status: "succeeded",
    when_completed: "2026-07-24T02:00:00.000Z",
  },
});
const signature = createHmac("sha256", process.env.WAVE_WEBHOOK_SECRET!)
  .update(rawWebhook)
  .digest("hex");
const event = await waslPay.handleWebhook(rawWebhook, {
  "x-wave-signature": signature,
});

// 4. Remboursement partiel. Wave et MTN le prennent en charge ; Orange le rejette.
const refund = await waslPay.refund(session.id, 500);

console.log(JSON.stringify({ session, statusResult, event, refund }, null, 2));
```

Sortie réellement capturée contre `waslpay dev` local :

```json
{
  "session": {
    "id": "wave_2302a514-62f3-4f73-b85c-568938e3f083",
    "reference": "quickstart-order-123",
    "amount": 1000,
    "currency": "XOF",
    "status": "pending",
    "paymentUrl": "http://127.0.0.1:4004/mock/wave/checkout/wave_2302a514-62f3-4f73-b85c-568938e3f083"
  },
  "statusResult": {
    "status": "pending"
  },
  "event": {
    "id": "quickstart-event-1",
    "sessionId": "wave_2302a514-62f3-4f73-b85c-568938e3f083",
    "status": "success",
    "reference": "quickstart-order-123",
    "occurredAt": "2026-07-24T02:00:00.000Z"
  },
  "refund": {
    "sessionId": "wave_2302a514-62f3-4f73-b85c-568938e3f083",
    "refundId": "refund_d0ac079b-5292-4cb4-bd4a-09141531cb21",
    "amount": 500,
    "status": "success"
  }
}
```

## Et ensuite

- [Sécuriser les webhooks](../guides/webhooks)
- [Comprendre les remboursements](../guides/refunds)
- [Référence du contrat provider](../reference/contract)
- [Compatibilité des providers et runtimes](../compatibility)
