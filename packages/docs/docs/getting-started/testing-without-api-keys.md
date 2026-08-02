---
sidebar_position: 2
---

# Tester sans clés API

Vous pouvez développer le flux de paiement avant d'obtenir des clés sandbox ou de
production. Le mode mock appelle les vraies classes `WaveProvider`,
`OrangeMoneyProvider` et `MtnMomoProvider`, mais redirige leurs requêtes HTTP vers
`waslpay dev` localement. Lorsque vous passez en production, le code applicatif
reste inchangé : seules les valeurs de votre fichier d'environnement changent.

Les exemples ci-dessous utilisent Wave. Orange Money et MTN MoMo suivent le même
principe avec `ORANGE_MONEY_BASE_URL` et `MTN_MOMO_BASE_URL`.

## Démarrer le mock local

Générez d'abord l'intégration et les variables de démonstration. Les trois options
de sélection sont requises ensemble en mode non interactif :

```bash
wasl init --language node --framework express --providers wave --mock
```

Le fichier `.env.waslpay.example` créé contient notamment :

```dotenv
# Mode test sans clés (--mock). Lancez `wasl dev` pour démarrer le serveur mock.
# Pour passer en production, remplacez UNIQUEMENT ces valeurs par vos vraies clés et supprimez les lignes *_BASE_URL -- aucune modification de code n'est nécessaire.
WAVE_API_KEY=mock_wave_key
WAVE_WEBHOOK_SECRET=mock_wave_webhook
WAVE_BASE_URL=http://localhost:4004/mock/wave
```

Dans un second terminal, démarrez le serveur local :

```bash
wasl dev
```

Laissez ce processus actif pendant les exemples qui suivent.

## Node.js

Chargez les valeurs de votre `.env`, dont `WAVE_BASE_URL` en mode mock. Si cette
variable n'est pas définie, le provider reprend automatiquement l'URL réelle de
Wave.

```ts
import { WaveProvider } from "@waslpay/core-node";

const provider = new WaveProvider({
  apiKey: process.env.WAVE_API_KEY!,
  webhookSecret: process.env.WAVE_WEBHOOK_SECRET!,
  baseUrl: process.env.WAVE_BASE_URL,
});

const session = await provider.initiatePayment({
  amount: 1000,
  currency: "XOF",
  reference: "wave-local-mock-check",
  customerPhone: "+221770000000",
  successUrl: "http://localhost/success",
  failureUrl: "http://localhost/failure",
});

console.log(JSON.stringify(session, null, 2));
```

Sortie réellement capturée contre le mock local :

```json
{
  "id": "wave_a2984f85-2e04-47f9-ad3c-f556193054ff",
  "reference": "wave-local-mock-check",
  "amount": 1000,
  "currency": "XOF",
  "status": "pending",
  "paymentUrl": "http://127.0.0.1:4004/mock/wave/checkout/wave_a2984f85-2e04-47f9-ad3c-f556193054ff"
}
```

## PHP

Le SDK PHP dépend d'un client PSR-18. Pour cet exemple avec Guzzle :

```bash
composer require guzzlehttp/guzzle
```

Le dernier argument du constructeur est l'override facultatif de l'URL de base.

```php
<?php

declare(strict_types=1);

use GuzzleHttp\Client;
use WaslPay\Sdk\DTO\PaymentRequest;
use WaslPay\Sdk\Providers\WaveProvider;

$provider = new WaveProvider(
    new Client(),
    getenv('WAVE_API_KEY'),
    getenv('WAVE_WEBHOOK_SECRET'),
    null,
    getenv('WAVE_BASE_URL') ?: null,
);

$session = $provider->initiatePayment(new PaymentRequest(
    amount: 1000,
    currency: 'XOF',
    reference: 'wave-php-mock-example',
    customerPhone: '+221770000000',
    successUrl: 'http://localhost/success',
    failureUrl: 'http://localhost/failure',
));

echo json_encode([
    'id' => $session->id,
    'status' => $session->status->value,
    'paymentUrl' => $session->paymentUrl,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
```

Sortie réellement capturée contre le mock local :

```json
{
    "id": "wave_948c99ba-6f2e-4cb7-a654-eee8cf2a884b",
    "status": "pending",
    "paymentUrl": "http://127.0.0.1:4004/mock/wave/checkout/wave_948c99ba-6f2e-4cb7-a654-eee8cf2a884b"
}
```

## Python

Avec un `httpx.AsyncClient`, passez la même valeur d'environnement au paramètre
`base_url` facultatif :

```python
import asyncio
import json
import os

import httpx

from waslpay.models import PaymentRequest
from waslpay.providers import WaveProvider


async def main() -> None:
    async with httpx.AsyncClient() as client:
        provider = WaveProvider(
            client,
            api_key=os.environ["WAVE_API_KEY"],
            webhook_secret=os.environ["WAVE_WEBHOOK_SECRET"],
            base_url=os.getenv("WAVE_BASE_URL") or None,
        )
        session = await provider.initiate_payment(PaymentRequest(
            amount=1000,
            currency="XOF",
            reference="wave-python-mock-example",
            customer_phone="+221770000000",
            success_url="http://localhost/success",
            failure_url="http://localhost/failure",
        ))
        print(json.dumps({
            "id": session.id,
            "status": session.status.value,
            "payment_url": session.payment_url,
        }, indent=2))


asyncio.run(main())
```

Sortie réellement capturée contre le mock local :

```json
{
  "id": "wave_5cc4fe07-5c6c-4dea-8c7b-282cd7b68b30",
  "status": "pending",
  "payment_url": "http://127.0.0.1:4004/mock/wave/checkout/wave_5cc4fe07-5c6c-4dea-8c7b-282cd7b68b30"
}
```

## Passer en production

Ne modifiez pas le code précédent. Dans votre environnement de production,
remplacez uniquement les valeurs mock par les identifiants marchands Wave et
supprimez la ligne `WAVE_BASE_URL` :

```dotenv
# Production
WAVE_API_KEY=wave_sn_prod_votre_cle_marchande
WAVE_WEBHOOK_SECRET=votre_secret_webhook_wave
# WAVE_BASE_URL est volontairement absente : le SDK utilise https://api.wave.com/v1.
```

Appliquez la même règle aux autres providers : conservez leur constructeur et
leurs appels métier, remplacez les identifiants, puis retirez seulement leur
variable `*_BASE_URL`. N'utilisez jamais les clés factices du mode mock en
production.
