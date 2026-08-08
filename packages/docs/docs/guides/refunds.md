---
sidebar_position: 2
---

# Remboursements

WaslPay unifie la demande de remboursement à travers la méthode `waslPay.refund(sessionId, amount)`. Cependant, les capacités de remboursement varient selon les API publiques des opérateurs.

## 1. Support par provider

- **Wave** : Prise en charge des remboursements totaux et partiels via l'API Checkout.
- **MTN MoMo** : Prise en charge des remboursements totaux et partiels via l'API Collection (traitement potentiellement asynchrone).
- **Orange Money** : **Non disponible**. L'API publique Orange Money eWallet n'expose pas de remboursement marchand automatique en self-service. Appeler `refund()` sur un provider Orange Money lève une erreur `OrangeMoneyProviderError`.

Pour consulter la matrice complète et détaillée des capacités, référez-vous au document [Compatibilité WaslPay](../compatibility.md#capacités-par-provider-identiques-dans-les-3-langages).

## 2. Règles et limitations de remboursement

1. **Montant valide** : Le montant doit être un entier strictement positif exprimé en unités mineures (ex. FCFA XOF).
2. **Plafond du montant original** : Le montant demandé ne peut pas dépasser le montant original de la session de paiement initiale. Dans le cas contraire, le SDK lève une erreur `PaymentError.RefundAmountExceedsBalance`.
3. **Historique des remboursements** : Le SDK vérifie le montant par rapport au montant initial de la session. Il ne conserve pas encore d'historique persistant des remboursements partiels successifs pour calculer un solde cumulé.

## 3. Exemple d'exécution complet (Node.js)

Voici un exemple d'exécution d'un remboursement partiel de 500 XOF sur une session initiale :

```ts
import { WaslPay, WaveProvider } from "@waslpay/core-node";

const provider = new WaveProvider({
  apiKey: process.env.WAVE_API_KEY!,
  webhookSecret: process.env.WAVE_WEBHOOK_SECRET!,
  baseUrl: process.env.WAVE_BASE_URL,
});
const waslPay = new WaslPay(provider);

const sessionId = "wave_2302a514-62f3-4f73-b85c-568938e3f083";

/**
 * Exécution d'un remboursement partiel de 500 XOF.
 */
const refund = await waslPay.refund(sessionId, 500);

console.log("Résultat du remboursement:", refund);
```

### Sortie `RefundResult` réellement capturée contre `waslpay dev`

```json
{
  "sessionId": "wave_2302a514-62f3-4f73-b85c-568938e3f083",
  "refundId": "refund_b3855805-24fe-42bb-a015-6eac6f97ac4f",
  "amount": 500,
  "status": "success"
}
```
