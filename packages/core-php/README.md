# WaslPay Core PHP

SDK PHP 8.1+ fondé sur PSR-18, PSR-7 et des DTO immuables.

## Installation

```bash
composer require waslpay/core-php
```

Pour développer ce monorepo :

```bash
composer install
```

## Configuration et initialisation

Injectez un client HTTP PSR-18 et le provider choisi dans la façade.

```php
<?php

use GuzzleHttp\Client;
use WaslPay\Sdk\WaslPay;
use WaslPay\Sdk\Providers\WaveProvider;

$provider = new WaveProvider(
    new Client(),
    getenv('WAVE_API_KEY'),
    getenv('WAVE_WEBHOOK_SECRET'),
);
$waslPay = new WaslPay($provider);
```

Variables `.env` :

```dotenv
ORANGE_MONEY_CLIENT_ID=
ORANGE_MONEY_CLIENT_SECRET=
ORANGE_MONEY_MERCHANT_CODE=
ORANGE_MONEY_SITENAME=
ORANGE_MONEY_CALLBACK_URL=
ORANGE_MONEY_WEBHOOK_API_KEY=
ORANGE_MONEY_ENVIRONMENT=sandbox
WAVE_API_KEY=
WAVE_WEBHOOK_SECRET=
MTN_MOMO_SUBSCRIPTION_KEY=
MTN_MOMO_API_USER=
MTN_MOMO_API_KEY=
MTN_MOMO_TARGET_ENVIRONMENT=sandbox
MTN_MOMO_DEFAULT_CURRENCY=XOF
```

`OrangeMoneyProvider` reçoit le client PSR-18, les credentials OAuth, le contexte marchand et la clé webhook. `MtnMomoProvider` reçoit le client, la subscription key, l'API user, l'API key, l'environnement et la devise par défaut.

## Flux de paiement complet

```php
<?php

declare(strict_types=1);

use WaslPay\Sdk\DTO\PaymentRequest;

/**
 * Initialisation d'une nouvelle session de paiement.
 */
$session = $waslPay->initiatePayment(new PaymentRequest(
    amount: 1000,
    currency: 'XOF',
    reference: 'order-123',
    customerPhone: '+221770000000',
    successUrl: 'https://merchant.example/payments/success',
    failureUrl: 'https://merchant.example/payments/failed',
));

/**
 * Interrogation et vérification du statut courant de la session via PaymentStatusResult.
 */
$statusResult = $waslPay->checkStatus($session->id);
if ($statusResult->status === PaymentStatus::Failed) {
    $error = $statusResult->error;
}

/**
 * Traitement du webhook sur le flux HTTP brut (php://input).
 */
$rawBody = file_get_contents('php://input');
$event = $waslPay->handleWebhook($rawBody, getallheaders());

/**
 * Demande de remboursement partiel ou total.
 */
$refund = $waslPay->refund($session->id, 500);
```

Traitez `PaymentEvent::$id` de manière idempotente et répondez seulement après validation du header de sécurité par l'adaptateur.

## Erreurs normalisées

| PaymentError | Orange Money | Wave | MTN MoMo |
| --- | --- | --- | --- |
| `INSUFFICIENT_FUNDS` | `2020`, `2021` | `insufficient-funds` | `NOT_ENOUGH_FUNDS` |
| `PROVIDER_TIMEOUT` | Erreurs techniques | HTTP 5xx ou timeout | HTTP 5xx ou timeout |
| `INVALID_PHONE` | `2000`, `2001` | Mismatch du mobile | Validation MSISDN/provider |
| `USER_CANCELLED` | Annulation client | Paiement annulé | `APPROVAL_REJECTED`, `EXPIRED` |
| `UNKNOWN` | Autre erreur | Autre erreur | Autre erreur |

Les adaptateurs lèvent `ProviderException`; consultez sa propriété `paymentError` pour appliquer une décision métier sûre.

## Tester sans clés API

Lancez `waslpay dev`, puis passez `http://localhost:4004/mock/wave` comme dernier
argument `baseUrlOverride` du vrai `WaveProvider`. En production, retirez seulement
cette URL et remplacez les valeurs d'environnement.

## Tests

```bash
vendor/bin/phpunit
```

Les classes de tests provider étendent le contrat réutilisable et utilisent des clients HTTP mockés.
