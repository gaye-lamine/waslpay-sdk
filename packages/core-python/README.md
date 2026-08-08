# WaslPay Core Python

SDK Python 3.10+ asynchrone, avec modèles Pydantic v2 immuables et HTTPX.

## Installation

```bash
pip install waslpay-sdk
# ou
poetry add waslpay-sdk
```

Pour développer ce package :

```bash
poetry install
```

## Configuration et initialisation

Injectez un `httpx.AsyncClient` dans le provider choisi.

```python
import os
import httpx

from waslpay import WaslPay
from waslpay.providers import WaveProvider

client = httpx.AsyncClient()
provider = WaveProvider(
    client,
    api_key=os.environ["WAVE_API_KEY"],
    webhook_secret=os.environ["WAVE_WEBHOOK_SECRET"],
)
waslpay = WaslPay(provider)
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

## Flux de paiement complet

```python
from fastapi import FastAPI, Request
from waslpay import PaymentRequest

app = FastAPI()

"""Initialisation d'une nouvelle session de paiement."""
session = await waslpay.initiate_payment(PaymentRequest(
    amount=1000,
    currency="XOF",
    reference="order-123",
    customer_phone="+221770000000",
    success_url="https://merchant.example/payments/success",
    failure_url="https://merchant.example/payments/failed",
))

"""Interrogation et vérification du statut courant de la session via PaymentStatusResult."""
status_result = await waslpay.check_status(session.id)
if status_result.status is PaymentStatus.FAILED:
    error = status_result.error

"""Traitement du webhook sur le corps HTTP brut (raw_body)."""
@app.post("/webhooks/payments")
async def webhook(request: Request) -> dict[str, str]:
    raw_body = await request.body()
    event = await waslpay.handle_webhook(raw_body, dict(request.headers))
    return {"event_id": event.id}

"""Demande de remboursement partiel ou total."""
refund = await waslpay.refund(session.id, 500)
```

Fermez le client HTTPX au cycle de vie de votre application avec `await client.aclose()`.

## Erreurs normalisées

| PaymentError | Orange Money | Wave | MTN MoMo |
| --- | --- | --- | --- |
| `INSUFFICIENT_FUNDS` | `2020`, `2021` | `insufficient-funds` | `NOT_ENOUGH_FUNDS` |
| `PROVIDER_TIMEOUT` | Erreur technique | HTTP 5xx ou timeout | HTTP 5xx ou timeout |
| `INVALID_PHONE` | `2000`, `2001` | Erreur de mobile | Validation MSISDN/provider |
| `USER_CANCELLED` | Annulation client | Paiement annulé | `APPROVAL_REJECTED`, `EXPIRED` |
| `UNKNOWN` | Autre erreur | Autre erreur | Autre erreur |

Les adaptateurs lèvent `ProviderError`; inspectez `error.code` et effectuez un `check_status` après un timeout avant toute action métier.

## Tester sans clés API

Lancez `waslpay dev`, puis passez `base_url="http://localhost:4004/mock/wave"`
au vrai `WaveProvider`. En production, retirez seulement `base_url` et remplacez
les valeurs d'environnement.

## Tests

```bash
poetry run pytest
poetry run mypy waslpay
```

Les tests utilisent `pytest-asyncio` et `respx` pour rejouer les échanges HTTP des providers.
