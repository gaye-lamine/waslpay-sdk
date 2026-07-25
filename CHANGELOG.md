# Changelog

Toutes les modifications notables du SDK WaslPay (anciennement PayAfrica) sont documentées dans ce
fichier.

## 3.0.4 — 2026-07-25

### Fixed

- **CLI**: Python and PHP generated boilerplates failed at runtime with TypeError (missing HTTP client argument) despite being syntactically valid -- found via a real blind end-to-end test with FastAPI. Also aligned the default webhook route across all 3 languages to match `waslpay dev`'s default target (`/api/webhooks/waslpay`). Added real instantiation tests (not just syntax checks) for all 3 languages.

## 3.0.3 — 2026-07-25

### Fixed

- **CLI**: generated boilerplates (Node, PHP, Python) were syntactically invalid and could not run -- discovered via a real blind end-to-end test with FastAPI. All generators now produce executable code, verified by `py_compile`, `node --check`, and `php -l`.

## 3.0.2 — 2026-07-24

### Renaming, Rebranding & Versioning

- Renommage officiel du projet et de l'ensemble de ses packages de **PayAfrica** à **WaslPay** :
  - `@payafrica/core-node` $\to$ `@waslpay/core-node` (classe `WaslPay`).
  - `@payafrica/cli` $\to$ `@waslpay/cli` (binaire `waslpay`).
  - `payafrica/core-php` $\to$ `waslpay/core-php` (namespace `WaslPay\Sdk`).
  - `payafrica-sdk` (Python) $\to$ `waslpay-sdk` (module `waslpay`).
  - `@payafrica/docs` $\to$ `@waslpay/docs`.
  - `@payafrica/landing` $\to$ `@waslpay/landing`.
  - En-tête HTTP webhook générique $\to$ `x-waslpay-signature`.
- **Alignement de version à 3.0.2** : Saut de version majeur délibéré pour l'ensemble des packages du monorepo afin d'éviter toute collision avec les tags Git `v1.0.0` et `v2.0.0` historiques de l'ancien projet PayAfrica.

## Unreleased

### Fixes

- Les providers Wave Node, PHP et Python lisent maintenant le champ d'erreur
  top-level `code` en plus de `error_code`, afin que les réponses utilisant cette
  forme participent au mapping vers `PaymentError`. `no-matching-api-key` reste
  normalisé en `UNKNOWN`, car le contrat commun ne possède pas de code dédié aux
  identifiants API invalides.

## 2.0.0 — 2026-07-22

### Breaking changes

- `checkStatus` ne retourne plus un `PaymentStatus` seul. Dans les SDK Node,
  PHP et Python, il retourne maintenant un `PaymentStatusResult` contenant
  `status` et, uniquement pour un échec, `error`.
- Les intégrateurs doivent remplacer les comparaisons directes avec le résultat
  de `checkStatus` par la lecture de `result.status`. Lorsque ce statut vaut
  `failed`, `result.error` contient obligatoirement le `PaymentError`
  normalisé. Les implémentations externes de `PaymentProvider` doivent adopter
  ce nouveau type de retour.

### Features

- Ajout de `PaymentStatusResult` et propagation de la cause normalisée d'un
  échec de paiement pour Orange Money, Wave et MTN MoMo.
- Idempotence des webhooks via `WebhookEventStore` injectable et une
  implémentation mémoire par défaut, partagée durant la vie d'une instance de
  provider.
- Validation locale des remboursements Wave et MTN MoMo avant tout appel de
  remboursement : montant entier positif sûr et plafond égal au montant
  original connu de la transaction.
- Nouveaux codes `PaymentError` : `INVALID_REFUND_AMOUNT` et
  `REFUND_AMOUNT_EXCEEDS_BALANCE`.
- Prise en charge de `PaymentStatus.Expired` pour Wave dans les SDK Node, PHP
  et Python, à partir de `checkout_status: "expired"` et des webhooks Wave.
  Orange Money et MTN MoMo restent explicitement non supportés pour ce statut.
- Invariant de `PaymentStatusResult` vérifié à l'exécution en PHP et Python,
  et par l'union discriminée TypeScript en Node.

### Fixes

- Les SDK Python alignent désormais le traitement des statuts provider
  inconnus sur Node et PHP : ils sont rejetés comme `UNKNOWN` au lieu d'être
  silencieusement transformés en `failed`.
- Le remboursement total est explicitement exempté du contrôle de dépassement
  de montant original ; seul un montant partiel fourni est comparé au plafond.
