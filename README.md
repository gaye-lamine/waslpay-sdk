# WaslPay SDK

La couche d'abstraction de paiement unifiée pour l'Afrique de l'Ouest et Centrale : Orange Money, Wave et MTN MoMo.

![License MIT](https://img.shields.io/badge/license-MIT-111827)
![Build Status](https://img.shields.io/badge/build-local%20validation-0f766e)
[![npm version](https://img.shields.io/npm/v/@waslpay/core-node?label=npm)](https://www.npmjs.com/package/@waslpay/core-node)
[![Packagist version](https://img.shields.io/packagist/v/waslpay/core-php?label=Packagist)](https://packagist.org/packages/waslpay/core-php)
[![PyPI version](https://img.shields.io/pypi/v/waslpay-sdk?label=PyPI)](https://pypi.org/project/waslpay-sdk/)

La documentation publique est disponible sur [gaye-lamine.github.io/waslpay](https://gaye-lamine.github.io/waslpay/).

## Pourquoi WaslPay ?

Intégrer les moyens de paiement mobile impose habituellement de gérer une API par provider : des flux OAuth2 différents, des webhooks signés en HMAC ou validés par API key, des réponses asynchrones, et des formats d'erreurs incompatibles. WaslPay fournit une interface unique, `WaslPay`, au-dessus d'adaptateurs isolés.

- Les adaptateurs appellent directement les API Orange Money, Wave et MTN MoMo avec vos propres identifiants marchands. WaslPay ne demande pas de compte auprès d'un intermédiaire ; un compte et un contrat avec l'opérateur choisi restent nécessaires.
- Le SDK n'ajoute aucun frais d'intermédiaire aux transactions. Les frais applicables relèvent de la relation commerciale avec l'opérateur.
- Le code est open source et le contrat est public dans [spec/provider-interface.md](spec/provider-interface.md). Les contributions sont ouvertes via le dépôt ; une gouvernance communautaire formalisée n'est pas encore publiée.

## Quickstart en 30 secondes

Générez un point de départ adapté à votre stack :

```bash
npx @waslpay/cli init
```

```text
Welcome to WaslPay SDK Generator

? Langage backend cible ? Node.js (TypeScript)
? Framework utilisé ? Fastify
? Providers à activer ? Orange Money Sénégal, Wave Sénégal, MTN MoMo

Generated:
  .env.waslpay.example
  waslpay-integration.ts
```

La CLI génère les variables d'environnement nécessaires et un exemple d'initialisation avec une route webhook adaptée au framework sélectionné.

## Matrice de compatibilité

| Opérateur | Pays | Auth | Webhook | Refund natif | Statut SDK |
| --- | --- | --- | --- | --- | --- |
| Orange Money | SN | OAuth2 client credentials | API key | Non | Référence Node, PHP, Python |
| Wave | SN, CI | Bearer API key | HMAC-SHA256 | Oui | Référence Node, PHP, Python |
| MTN MoMo | CI, BJ, GH, CM, UG | OAuth2 Basic/Bearer | Subscription key | Oui, asynchrone | Référence Node, PHP, Python |

La disponibilité effective dépend du contrat marchand et du pays activé auprès de chaque opérateur.

## Écosystème et packages

| Package | Runtime | Description |
| --- | --- | --- |
| [@waslpay/core-node](packages/core-node) | TypeScript / Node.js | Contrat, façade et providers de référence. |
| [waslpay/core-php](packages/core-php) | PHP 8.1+ / PSR-18 | Contrat PHP, façade et adaptateurs HTTP injectables. |
| [waslpay-sdk](packages/core-python) | Python 3.10+ / Pydantic v2 | Contrat asynchrone, modèles immuables et providers HTTPX. |
| [@waslpay/cli](packages/cli) | Node.js | Générateur interactif d'intégration. |

## Même intention, trois runtimes

| TypeScript | PHP | Python |
| --- | --- | --- |
| `const sdk = new WaslPay(provider);` | `$sdk = new WaslPay($provider);` | `sdk = WaslPay(provider)` |
| `await sdk.initiatePayment(request);` | `$sdk->initiatePayment($request);` | `await sdk.initiate_payment(request)` |
| `await sdk.handleWebhook(raw, headers);` | `$sdk->handleWebhook($raw, $headers);` | `await sdk.handle_webhook(raw, headers)` |

## Architecture et sécurité

`WaslPay` ne contient aucune logique d'opérateur. Chaque provider implémente le contrat défini dans [spec/provider-interface.md](spec/provider-interface.md), traduit ses statuts et mappe ses erreurs vers un vocabulaire commun.

Les identifiants, secrets, clés API et clés de webhook doivent uniquement être lus depuis les variables d'environnement. Ne les commitez jamais. Les handlers webhook doivent toujours transmettre le body HTTP brut et les headers au provider : la vérification de signature ou de clé doit être effectuée avant toute désérialisation ou mise à jour métier.

## Compatibilité

Consultez [COMPATIBILITY.md](COMPATIBILITY.md) pour les capacités par provider,
la différence de validation `PaymentStatusResult` entre les SDK, et les limites
du store d'idempotence par défaut.

## Contribution

Pour ajouter un provider :

1. Lisez et implémentez exactement [spec/provider-interface.md](spec/provider-interface.md).
2. Isolez tous les détails API, statuts et erreurs dans l'adaptateur du provider.
3. Ajoutez les sept scénarios de tests de contrat avant toute proposition de merge.
4. N'ajoutez jamais de secret réel dans le dépôt ou dans les fixtures de test.

## Licence

Distribué sous licence MIT.
