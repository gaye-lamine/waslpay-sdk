# Changelog

Toutes les modifications notables du SDK WaslPay (anciennement PayAfrica) sont documentées dans ce
fichier.

## 3.0.15 — 2026-08-03

### Fixed

- **CLI**: Documented explicit `.env.waslpay.example` copy/merge requirement into project `.env` for Laravel and Symfony in generated boilerplates and CLI README.
- **CLI**: Formatted generated Laravel controller route definition comments to match copy-pasteable `Route::post(...)` syntax for `routes/api.php`.

## 3.0.14 — 2026-08-03

### Fixed

- **CLI**: Express boilerplate had a global `express.json()` middleware that consumed the webhook route's raw body before `express.raw()` could read it, breaking HMAC signature verification — found via a real blind end-to-end test. `express.json()` is now scoped per-route (checkout, refund), webhook routes keep exclusive access to the raw body. Test now actually executes the generated code in a subprocess instead of comparing hand-written reference implementations.

## 3.0.13 — 2026-08-02

### Fixed

- **CLI**: `fix(cli): generated boilerplates never loaded .env.waslpay.example -- Node (all 6 templates) had no dotenv loading at all, PHP native called getenv() without initializing dotenv, and Python called load_dotenv() without the correct filename (loaded default .env instead of .env.waslpay.example). Found via a real blind end-to-end test on Express. Added 8 parity tests across all 3 languages to catch future regressions.`

## 3.0.12 — 2026-08-02

### Changed

- **Docs**: Restore open source framing in `introduction.md` and `README.md` — the SDK remains free and MIT-licensed; this is a factual statement, not a positioning choice.
- **CLI**: Add `wasl` short binary alias — `wasl dev`, `wasl init`, `wasl doctor`, `wasl trigger` are now equivalent to `waslpay <command>` and require no flags (all options have sensible defaults).

## 3.0.11 — 2026-08-01

### Fixed

- **Docs**: Playground page rewritten with a step-by-step guide (install `waslpay dev`, expected terminal output, sandbox workflow) before the interactive component — the prerequisite command is now visible before the user interacts with the playground.
- **Docs**: Removed "open source" mentions from all user-facing content (`introduction.md`, `README.md`).
- **Docs**: Mode toggle labels replaced with user-facing language ("Sandbox (sans backend)" / "Mon application") instead of technical terms.

## 3.0.10 — 2026-08-01

### Added

- **CLI**: `waslpay dev` now exposes a transparent reverse-proxy at `/proxy/*` that forwards requests from the browser playground to the integrator's local backend and adds CORS headers on the response. This allows the public documentation playground (`https://gaye-lamine.github.io/waslpay-sdk/playground`) to reach `http://localhost` backends without requiring any CORS configuration on the backend side.
- **Docs**: Interactive API Playground page added to the Docusaurus documentation (`/docs/playground`). Supports Initiate Payment, Check Status, Webhook simulation, and Refund for all three providers (Wave, Orange Money, MTN MoMo), with real-time JSON response display and precise diagnostic messages on connection failure.

### Fixed

- **CLI**: `waslpay dev` CORS headers are now correctly set on all responses including the OPTIONS preflight, fixing `ERR_FAILED` errors when the playground or any browser client targets the dev mock server from a different origin.
- **CLI generators**: Generated FastAPI (Python) boilerplates now include `CORSMiddleware`; generated Express (Node.js) boilerplates now include a CORS middleware, enabling browser clients to call the generated backend without additional configuration.

## 3.0.9 — 2026-08-01

### Fixed

- **Core (Node, PHP, Python)**: PaymentEvent.error was never populated on failed webhook events across Node, PHP and Python, despite the documented contract requiring it -- found via manual end-to-end testing. The invariant (error required when status is Failed, forbidden otherwise) is now enforced at construction in all 3 languages, matching PaymentStatusResult's existing guarantee.

## 3.0.8 — 2026-07-29

### Fixed

- **CLI**: `waslpay trigger` defaulted `--secret` to a hardcoded Wave value, so simulating orange or mtn webhooks without explicitly passing `--secret` always failed with an invalid key/signature error -- found via a real blind end-to-end multi-provider FastAPI test. Centralized mock secrets (`DEV_MOCK_SECRETS`) as a single source shared between `dev.ts`, `trigger.ts`, and `env.ts`, with regression tests to catch future divergence.

## 3.0.7 — 2026-07-27

### Fixed

- **CLI**: clarify that `waslpay trigger` supports the full `<provider>.payment.<success|failed>` event matrix for all 3 providers (Wave, Orange Money, MTN MoMo). Added 8 new 3x2 matrix contract tests.

## 3.0.6 — 2026-07-27

### Added / Fixed

- **CLI**: feat(cli): generated boilerplates now support multiple providers correctly -- previously, selecting several providers silently wired only the first one. Each selected provider now gets its own instance, dedicated checkout route, and dedicated webhook route where needed (Orange Money's callback URL). Fixed across Node.js, PHP, and Python, with 32 new consistency and instantiation tests. Found via a real blind end-to-end test with FastAPI.

## 3.0.5 — 2026-07-26

### Fixed

- **CLI**: `waslpay dev` and `waslpay trigger` sent a generic `x-waslpay-signature` header that none of the 3 real providers understand -- Wave expects `x-wave-signature` (HMAC), Orange expects a raw `x-api-key`, MTN expects a raw `ocp-apim-subscription-key`. Found via a real blind end-to-end test with FastAPI. Both commands are now provider-aware and match each provider's real webhook verification contract, with positive and negative contract tests for all 3.

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
