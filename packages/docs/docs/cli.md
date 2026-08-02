---
sidebar_position: 5
---

# CLI WaslPay

La CLI génère une intégration, lance le simulateur local, vérifie votre
configuration et envoie des webhooks signés.

**Installation globale (recommandée) :**

```bash
npm install -g @waslpay/cli
```

Après cette installation unique, toutes les commandes deviennent :

```bash
wasl init
wasl dev
wasl doctor
wasl trigger wave.payment.success
```

**Sans installation globale**, préfixez chaque commande par `npx @waslpay/cli` :

```bash
npx @waslpay/cli init
```

> Les exemples qui suivent utilisent `wasl`. Remplacez par `npx @waslpay/cli` si vous n'installez pas globalement.

## `waslpay init`

Sans option, `init` ouvre un assistant pour sélectionner le langage, le
framework, les providers et le mode mock ou API opérateur. Il crée
`.env.waslpay.example` et un fichier `waslpay-integration` adapté au
langage choisi.

```text
$ wasl init
Welcome to WaslPay SDK Generator 🌍

? Langage backend cible ? Node.js (TypeScript)
? Framework utilisé ? Express
? Providers à activer ? Wave Sénégal, MTN MoMo
? Mode test sans clés ? Oui — utiliser le mock local

WaslPay files generated
Review .env.waslpay.example, add your credentials locally, then wire the selected provider into your application.
```

### Mode non interactif

Pour un script CI, fournissez impérativement les trois options ensemble :
`--language`, `--framework` et `--providers`.

```bash
wasl init \
  --language node \
  --framework express \
  --providers wave,mtn-momo
```

Les langages admis sont `node`, `php` et `python`. Les providers sont
`orange-money`, `wave` et `mtn-momo`, séparés par une virgule. Un framework doit
être compatible avec le langage choisi.

### Mode mock sans clés

Ajoutez `--mock` au mode non interactif pour générer des identifiants fictifs
et les URLs locales du simulateur :

```bash
wasl init \
  --language node \
  --framework express \
  --providers wave \
  --mock
```

Le `.env.waslpay.example` contient alors :

```dotenv
WAVE_API_KEY=mock_wave_key
WAVE_WEBHOOK_SECRET=mock_wave_webhook
WAVE_BASE_URL=http://localhost:4004/mock/wave
```

Lancez ensuite `wasl dev`. Pour le parcours complet et le passage vers les
clés de production sans changement de code, consultez
[Tester sans clés API](./getting-started/testing-without-api-keys).

Si les options sont incomplètes ou invalides, la commande échoue sans ouvrir
l'assistant. Exemple observé :

```text
Error: Invalid --providers value: fake-provider. Expected one of: orange-money, wave, mtn-momo.
```

## `wasl dev`

Lance un checkout local, un simulateur de webhooks HMAC et les mocks HTTP
Orange Money, Wave et MTN MoMo. Les options sont `--port` (défaut `4004`) et
`--target` (défaut `http://localhost:8000/api/webhooks/waslpay`).

Commande minimale — les valeurs par défaut couvrent la majorité des cas :

```bash
wasl dev
```

Avec options explicites :

```bash
wasl dev --port 4004 --target http://localhost:8000/api/webhooks/waslpay
```

```text
WaslPay dev server listening on http://localhost:4004
Webhook target: http://localhost:8000/api/webhooks/waslpay
Webhook HMAC secret: whsec_dev_12345
```

En mode mock, configurez un provider avec l'une des URLs suivantes :

```text
http://localhost:4004/mock/orange
http://localhost:4004/mock/wave
http://localhost:4004/mock/mtn
```

## `wasl doctor`

Lit `.env.local`, puis `.env`, détecte les providers présents et vérifie leurs
variables requises ainsi que Node.js 20 ou supérieur.

```bash
wasl doctor
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

La commande utilise le code de sortie `1` lorsque la configuration est
incomplète, ce qui permet de l'employer en CI.

## `wasl trigger <event>`

Forge un webhook normalisé, le signe avec HMAC-SHA256 et l'envoie à une cible.
Les événements acceptés sont toutes les combinaisons suivantes :

```text
wave.payment.success      wave.payment.failed
orange.payment.success    orange.payment.failed
mtn.payment.success       mtn.payment.failed
```

Les options `--target` et `--secret` ont respectivement pour valeurs par défaut
`http://localhost:8000/api/webhooks/waslpay` et `whsec_dev_12345`.

```bash
wasl trigger wave.payment.success
```

```text
[200 OK] wave.payment.success envoyé à http://127.0.0.1:18001/api/webhooks/waslpay en 43 ms
```

Le code HTTP et le temps sont fournis par la cible réelle : ils ne sont pas des
valeurs fixes. Une route inexistante, par exemple, renvoie une sortie observée
de cette forme :

```text
[404 Not Found] wave.payment.success envoyé à http://localhost:8000/api/webhooks/waslpay en 95 ms
```

La commande utilise le code de sortie `1` lorsque la réponse HTTP n'est pas un
succès ou lorsque l'envoi réseau échoue.

Pour les détails de développement et les exemples additionnels, consultez le
[README de la CLI](https://github.com/gaye-lamine/waslpay-sdk/tree/main/packages/cli).
