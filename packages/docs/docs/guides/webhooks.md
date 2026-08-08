---
sidebar_position: 1
---

# Sécuriser et gérer les webhooks

Les webhooks permettent d'être notifié de manière asynchrone des changements de statut d'un paiement (ex. confirmation par le client ou échec). WaslPay garantit la sécurité et l'idempotence de ces notifications à travers la méthode `handleWebhook`.

## 1. Sécurité et vérification de signature HMAC

Pour éviter les attaques par rejeu ou l'injection de faux événements, chaque opérateur signe ses webhooks (ex. header `x-wave-signature` pour Wave).

**Règle d'or** : Transmettez toujours le **body HTTP brut** (`string` ou `Buffer`) et les headers entrants à `waslPay.handleWebhook`. Ne parsez pas puis ne re-sérialisez pas le corps JSON dans votre middleware HTTP avant la vérification : la signature HMAC dépend des octets exacts reçus du réseau.

Si la signature est invalide ou absente, l'adaptateur lève une exception `PaymentError.Unknown` (ex. `"Invalid Wave webhook signature"`), rejetant ainsi la requête avant tout traitement métier.

## 2. Idempotence et `WebhookEventStore`

Les opérateurs Mobile Money peuvent renvoyer le même événement webhook plusieurs fois en cas de latence réseau. Pour éviter les doubles crédits ou doubles traitements :

- **Comportement par défaut** : Chaque instance de provider instancie un `InMemoryWebhookEventStore` local. Il déduplique les événements (basé sur l'ID d'événement) **uniquement pendant la durée de vie de cette instance**.
- **Déploiements distribués et multi-workers** : Le store par défaut n'est pas partagé entre deux instances de provider ni conservé entre deux redémarrages. Dans un environnement de production (multi-processus, Kubernetes, Serverless), injectez un store persistant partagé (ex. basé sur Redis ou une base SQL) via l'option `webhookEventStore` du constructeur.

Pour en savoir plus sur les spécificités d'idempotence selon les langages, consultez le guide [Compatibilité WaslPay](../compatibility.md#idempotence-des-webhooks).

## 3. Exemple d'intégration complet (Express / Node.js)

Voici un exemple exécutable de réception et de validation d'un webhook Wave en Node.js :

```ts
import { createHmac } from "node:crypto";
import express from "express";
import { WaslPay, WaveProvider } from "@waslpay/core-node";

const app = express();

/**
 * Initialisation de l'adaptateur de paiement.
 */
const provider = new WaveProvider({
  apiKey: process.env.WAVE_API_KEY!,
  webhookSecret: process.env.WAVE_WEBHOOK_SECRET!,
  baseUrl: process.env.WAVE_BASE_URL,
});
const waslPay = new WaslPay(provider);

/**
 * Endpoint de traitement des webhooks.
 * Utilise express.raw pour garantir la conservation du corps HTTP brut (Buffer / string) requis pour la signature HMAC.
 */
app.post(
  "/webhooks/wave",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      /**
       * Traitement, validation cryptographique et déduplication de l'événement.
       */
      const event = await waslPay.handleWebhook(req.body, req.headers);

      console.log(`[Webhook Reçu] Event ID: ${event.id}, Statut: ${event.status}`);

      /**
       * Mise à jour de l'état de la commande métier en fonction de event.status.
       */
      if (event.status === "success") {
        await markOrderAsPaid(event.reference);
      }

      res.status(200).json({ accepted: true, eventId: event.id });
    } catch (error) {
      console.error("Échec de vérification du webhook:", error);
      res.status(400).json({ error: "Invalid webhook signature or payload" });
    }
  }
);
```

### Sortie `PaymentEvent` réellement capturée contre `waslpay dev`

Lorsque `handleWebhook` est appelé avec un payload et une signature HMAC SHA-256 valides pour une session créée (`wave_e37ba94b-4788-48ad-81be-7f1381a7e4df`), il retourne un objet `PaymentEvent` normalisé :

```json
{
  "id": "evt_wave_webhook_guide_001",
  "sessionId": "wave_e37ba94b-4788-48ad-81be-7f1381a7e4df",
  "status": "success",
  "reference": "webhook-guide-order-456",
  "occurredAt": "2026-07-24T03:14:00.000Z"
}
```


