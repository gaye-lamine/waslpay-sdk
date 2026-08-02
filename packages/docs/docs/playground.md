---
sidebar_position: 4
title: Playground
---

import ApiPlayground from '@site/src/components/ApiPlayground';

# Playground

Testez l'intégration WaslPay directement depuis cette page, sans écrire de code.

Deux modes sont disponibles :

- **Sandbox (sans backend)** : le mock WaslPay simule les APIs Orange Money, Wave et MTN MoMo. Aucun compte opérateur n'est requis. Idéal pour explorer le SDK.
- **Mon application** : les requêtes sont transmises à votre propre serveur en local. Vous voyez exactement ce que votre backend reçoit et retourne.

## Étape 1 — Installez et démarrez le serveur mock WaslPay

Le Playground communique avec un serveur local que vous démarrez dans votre terminal. Ce serveur joue le rôle de relais entre cette page et votre backend, et simule les APIs des opérateurs.

**Dans un terminal, lancez :**

```bash
wasl dev
```

> Si vous n'avez pas installé la CLI globalement : `npx @waslpay/cli dev`

Vous devriez voir :

```
WaslPay dev server listening on http://localhost:4004
Webhook target: http://localhost:8000/api/webhooks/waslpay
Backend proxy: http://localhost:4004/proxy/* → http://localhost:8000/*
Provider: wave
Webhook HMAC secret (WAVE_WEBHOOK_SECRET): mock_wave_webhook_secret
```

> Laissez ce terminal ouvert. Le serveur doit rester actif pendant toute la session de test.

## Étape 2 — Choisissez un mode et testez

En **mode Sandbox**, enchaînez les actions dans l'ordre suivant :

1. Sélectionnez **Initiate Payment** → cliquez **Exécuter**. Une session de paiement est créée et son ID est automatiquement copié.
2. Passez à **Check Status** → l'ID est pré-rempli → cliquez **Exécuter** pour vérifier le statut.
3. Passez à **Remboursement** → même ID → cliquez **Exécuter**.

En **mode Mon application**, démarrez également votre backend sur `http://localhost:8000` avant d'exécuter les requêtes.

---

<ApiPlayground />
