---
sidebar_position: 4
title: Playground Interactif
---

import ApiPlayground from '@site/src/components/ApiPlayground';

# 🧪 Playground Interactif WaslPay SDK

Ce bac à sable interactif vous permet d'exécuter et de tester directement en temps réel les endpoints de votre serveur backend local (**FastAPI**, **Express**, **Laravel**, etc.) ou du serveur mock WaslPay.

## Comment utiliser le Playground ?

1. **Assurez-vous que votre serveur backend tourne localement** (par exemple Uvicorn sur `http://localhost:8000`).
2. **Sélectionnez le provider** (Wave, Orange Money, MTN MoMo).
3. **Choisissez l'action à exécuter** :
   - **Initiate Payment** : Crée une nouvelle session de paiement (`POST /checkout/{provider}`).
   - **Check Status** : Vérifie le statut d'une session auprès du mock WaslPay (`GET /mock/{provider}/checkout/{id}`).
   - **Simuler Webhook** : Envoie un événement de paiement réussi ou échoué à votre route webhook (`POST /api/webhooks/waslpay/{provider}`).
   - **Demander un Remboursement** : Déclenche une demande de remboursement (`POST /refund/{provider}/{session_id}`).
4. **Cliquez sur "🚀 Exécuter la requête"** pour visualiser la réponse JSON et le statut HTTP en direct.

---

<ApiPlayground />

---

> [!TIP]
> **Mode Mock WaslPay**  
> Pour tester sans clés API marchandes réelles, démarrez le serveur mock local WaslPay dans votre terminal avec :  
> `npx @waslpay/cli dev --target http://localhost:8000/api/webhooks/waslpay`
