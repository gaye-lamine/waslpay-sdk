# WaslPay CLI

## Installation globale (recommandée)

Pour utiliser les commandes directes `wasl` ou `waslpay` (ex: `wasl dev`, `wasl init`) :

```bash
npm install -g @waslpay/cli
```

*Sans installation globale, vous devez préfixer vos commandes par `npx @waslpay/cli` (ex: `npx @waslpay/cli dev`).*

## Mode sans clés API

```bash
# Avec installation globale :
wasl init --language node --framework express --providers wave --mock
wasl dev

# Ou sans installation globale :
npx @waslpay/cli init --language node --framework express --providers wave --mock
npx @waslpay/cli dev
```

La commande génère `WAVE_API_KEY=mock_wave_key`, `WAVE_WEBHOOK_SECRET=mock_wave_webhook`
et `WAVE_BASE_URL=http://localhost:4004/mock/wave`. En production, remplacez
les clés et supprimez uniquement la ligne `WAVE_BASE_URL`.

La CLI WaslPay génère une base d'intégration, contrôle la configuration
locale et fournit un simulateur de webhooks de développement.

Pour le détail des providers, des variables d'environnement et des SDK,
consultez le [README principal](../../README.md).

## Installation

Exécutez la CLI sans installation globale :

```bash
npx @waslpay/cli init
```

## Commandes

### `init`

Lance un assistant qui sélectionne le langage, le framework et les providers,
puis génère `.env.waslpay.example` et un fichier d'intégration.

Sortie simplifiée : l'interface interactive réelle utilise des indicateurs
supplémentaires.

```text
$ npx @waslpay/cli init
Welcome to WaslPay SDK Generator 🌍

? Langage backend cible ? Node.js (TypeScript)
? Framework utilisé ? Express
? Providers à activer ? Wave Sénégal, MTN MoMo

WaslPay files generated
Review .env.waslpay.example, add your credentials locally, then wire the selected provider into your application.
(Note for Laravel & Symfony: copy or merge .env.waslpay.example into your project's .env file)
```

### `init` non interactif

Pour un script CI ou une installation automatisée, fournissez les trois options
ensemble : `--language`, `--framework` et `--providers`. Les valeurs admises
sont `node`, `php`, `python` ; les frameworks compatibles avec le langage ; et
`orange-money`, `wave`, `mtn-momo` pour les providers (séparés par des virgules).

```bash
npx @waslpay/cli init --language node --framework express --providers wave,mtn-momo
```

Cette commande s'exécute silencieusement avec le code de sortie `0`. Lors de
l'exécution réelle, elle a créé les fichiers suivants :

```text
.env.waslpay.example
waslpay-integration.ts
```

Les trois flags sont requis ensemble. Sans flag, la CLI lance l'assistant
interactif classique ; si une partie seulement des flags est fournie, elle
renvoie une erreur au lieu de demander les valeurs manquantes.

Exemple réel de valeur provider invalide (code de sortie `1`) :

```bash
npx @waslpay/cli init --language node --framework express --providers wave,fake-provider
```

```text
Error: Invalid --providers value: fake-provider. Expected one of: orange-money, wave, mtn-momo.
```

### `dev`

Démarre un checkout local et émet des webhooks HMAC vers votre application.

```bash
npx @waslpay/cli dev --port 4004 --target http://localhost:8000/api/webhooks/waslpay
```

```text
WaslPay dev server listening on http://localhost:4004
Webhook target: http://localhost:8000/api/webhooks/waslpay
Webhook HMAC secret: whsec_dev_12345
```

### `doctor`

Lit `.env.local` ou `.env`, détecte les providers configurés et signale les
clés manquantes.

```bash
npx @waslpay/cli doctor
```

```text
WaslPay doctor
[✓] Node.js v20.19.2 (v20+ requis)
[✓] .env trouvé

Wave
[✓] WAVE_API_KEY
[✗] WAVE_WEBHOOK_SECRET manquant

Configuration WaslPay incomplète.
```

### `trigger <event>`

Forge un webhook normalisé, le signe avec HMAC-SHA256 et l’envoie à la cible.
Les événements acceptés suivent le format `<provider>.payment.<success|failed>`
(ex: `wave.payment.success`, `orange.payment.success`, `mtn.payment.failed`).

Le code retour HTTP et le temps d'exécution dépendent de la cible réelle ; les
valeurs ci-dessous sont des sorties observées, pas des valeurs fixes.

Exemple avec une route indisponible :

```bash
npx @waslpay/cli trigger wave.payment.success --target http://localhost:8000/api/webhooks/waslpay
```

```text
[404 Not Found] wave.payment.success envoyé à http://localhost:8000/api/webhooks/waslpay en 95 ms
```

Exemple avec un receveur HTTP local qui répond `200 OK` :

```bash
npx @waslpay/cli trigger wave.payment.success --target http://127.0.0.1:18001/api/webhooks/waslpay
```

```text
[200 OK] wave.payment.success envoyé à http://127.0.0.1:18001/api/webhooks/waslpay en 43 ms
```
