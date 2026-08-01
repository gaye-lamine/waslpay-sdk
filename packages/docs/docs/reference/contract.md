---
sidebar_position: 1
---

# Contrat de provider

Tous les adaptateurs implémentent le contrat public suivant :

```ts
interface PaymentProvider {
  initiatePayment(params: PaymentRequest): Promise<PaymentSession>;
  checkStatus(sessionId: string): Promise<PaymentStatusResult>;
  handleWebhook(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<PaymentEvent>;
  refund(sessionId: string, amount?: number): Promise<RefundResult>;
}
```

## Types communs

`PaymentRequest` contient `amount`, `currency` et `reference`, avec les champs
optionnels `customerPhone`, `successUrl`, `failureUrl` et `metadata`.
`PaymentSession` retourne `id`, `reference`, `amount`, `currency`, `status`,
et éventuellement `paymentUrl` et `expiresAt`.

`PaymentStatus` vaut `pending`, `success`, `failed` ou `expired`.
`PaymentStatusResult` respecte une union discriminée : pour `pending`,
`success` ou `expired`, `error` est absent ; pour `failed`, `error` est une
valeur `PaymentError` obligatoire.

`PaymentEvent` contient `id`, `sessionId`, `status`, `occurredAt`, et peut
contenir `reference` et `error`. `RefundResult` contient `sessionId`,
`refundId`, `amount` et `status`.

`PaymentError` est limité à `INSUFFICIENT_FUNDS`, `PROVIDER_TIMEOUT`,
`INVALID_PHONE`, `INVALID_REFUND_AMOUNT`, `REFUND_AMOUNT_EXCEEDS_BALANCE`,
`USER_CANCELLED` et `UNKNOWN`.

## Créer une session

```ts
const session = await waslPay.initiatePayment({
  amount: 1_000,
  currency: "XOF",
  reference: "order-123",
  customerPhone: "+221770000000",
  successUrl: "https://app.example/success",
  failureUrl: "https://app.example/failed",
});

console.log(session.id, session.status, session.paymentUrl);
```

## Vérifier un statut

```ts
const result = await waslPay.checkStatus(session.id);

if (result.status === "failed") {
  console.error(result.error);
} else {
  console.log(result.status);
}
```

## Traiter un webhook

```ts
app.post("/webhooks/waslpay", express.raw({ type: "application/json" }), async (req, res) => {
  const event = await waslPay.handleWebhook(req.body, req.headers);
  res.status(200).json({ eventId: event.id, status: event.status });
});
```

Le body brut et les headers complets doivent être transmis avant toute
désérialisation : le provider vérifie sa signature ou sa clé de sécurité.

## Demander un remboursement

```ts
const refund = await waslPay.refund(session.id, 500);
console.log(refund.refundId, refund.amount, refund.status);

// Omettre amount demande un remboursement total.
const fullRefund = await waslPay.refund(session.id);
```

La spécification complète et normative est disponible dans
[provider-interface.md](https://github.com/gaye-lamine/waslpay-sdk/blob/main/spec/provider-interface.md).
