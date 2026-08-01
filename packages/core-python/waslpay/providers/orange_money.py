from __future__ import annotations

import base64
import json
import time
from typing import Any

import httpx

from ..contracts import PaymentProvider, WebhookHeaders
from ..enums import PaymentError, PaymentStatus
from ..errors import ProviderError
from ..models import PaymentEvent, PaymentRequest, PaymentSession, PaymentStatusResult, RefundResult
from ..webhook_event_store import InMemoryWebhookEventStore, WebhookEventStore


class OrangeMoneyProvider(PaymentProvider):
    _BASE_URLS = {"sandbox": "https://api.sandbox.orange-sonatel.com", "live": "https://api.orange-sonatel.com"}

    def __init__(self, client: httpx.AsyncClient, client_id: str, client_secret: str, merchant_code: str, sitename: str, callback_url: str, webhook_api_key: str, environment: str = "sandbox", webhook_event_store: WebhookEventStore | None = None, base_url: str | None = None) -> None:
        self._client, self._client_id, self._client_secret = client, client_id, client_secret
        self._merchant_code, self._sitename, self._callback_url, self._webhook_api_key = merchant_code, sitename, callback_url, webhook_api_key
        self._base_url = (base_url if base_url is not None else self._BASE_URLS[environment]).rstrip("/")
        self._token: str | None = None
        self._token_expires_at = 0.0
        # A module-global default leaks state between app instances and is not durable.
        # Inject a durable worker-shared store for production webhook handling.
        self._webhook_event_store = (
            webhook_event_store
            if webhook_event_store is not None
            else InMemoryWebhookEventStore()
        )

    async def initiate_payment(self, params: PaymentRequest) -> PaymentSession:
        payload = await self._request("POST", "/v1/onlinePayment/prepare", json={"merchantCode": self._merchant_code, "sitename": self._sitename, "amount": params.amount, "reference": params.reference, "urls": {"cancelUrl": params.failure_url or self._callback_url, "successUrl": params.success_url or self._callback_url, "callbackUrl": self._callback_url}})
        payment_url = payload.get("paymentUrl")
        if not isinstance(payment_url, str): raise ProviderError(PaymentError.UNKNOWN, "Orange Money response is missing paymentUrl")
        return PaymentSession(id=params.reference, reference=params.reference, amount=params.amount, currency=params.currency, status=PaymentStatus.PENDING, payment_url=payment_url)

    async def check_status(self, session_id: str) -> PaymentStatusResult:
        payload = await self._request("GET", "/api/eWallet/v1/transactions", params={"reference": session_id, "type": "WEB_PAYMENT"})
        transactions = payload.get("transactions")
        transaction = transactions[0] if isinstance(transactions, list) and transactions and isinstance(transactions[0], dict) else {}
        return self._status_result(transaction.get("status"), transaction.get("code"))

    async def handle_webhook(self, raw_body: str | bytes, headers: WebhookHeaders) -> PaymentEvent:
        if self._header(headers, "x-api-key") != self._webhook_api_key: raise ProviderError(PaymentError.UNKNOWN, "Invalid Orange Money webhook API key")
        payload = self._decode(raw_body)
        session_id, status = payload.get("reference") or payload.get("transactionId"), payload.get("status")
        if not isinstance(session_id, str): raise ProviderError(PaymentError.UNKNOWN, "Incomplete Orange Money webhook payload")
        event_id = payload.get("id") or payload.get("transactionId") or session_id
        payment_status = self._status(status)
        error = self._map_error(200, payload.get("code")) if payment_status is PaymentStatus.FAILED else None
        event = PaymentEvent(id=str(event_id), session_id=session_id, status=payment_status, occurred_at=str(payload.get("timestamp", "1970-01-01T00:00:00Z")), reference=payload.get("reference") if isinstance(payload.get("reference"), str) else None, error=error)
        return self._webhook_event_store.process(event, self._process_webhook_event)

    @staticmethod
    def _process_webhook_event(event: PaymentEvent) -> PaymentEvent:
        return event

    async def refund(self, session_id: str, amount: int | float | None = None) -> RefundResult:
        raise NotImplementedError("Orange Money does not support self-service merchant refunds")

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        token = await self._access_token()
        try: response = await self._client.request(method, self._base_url + path, headers={"Authorization": f"Bearer {token}"}, **kwargs)
        except httpx.HTTPError as exc: raise ProviderError(PaymentError.PROVIDER_TIMEOUT, str(exc)) from exc
        return self._response(response)

    async def _access_token(self) -> str:
        if self._token and time.time() < self._token_expires_at: return self._token
        basic = base64.b64encode(f"{self._client_id}:{self._client_secret}".encode()).decode()
        response = await self._client.post(self._base_url + "/oauth/v1/token", headers={"Authorization": f"Basic {basic}"}, data={"grant_type": "client_credentials"})
        payload = self._response(response); token = payload.get("access_token")
        if not isinstance(token, str): raise ProviderError(PaymentError.UNKNOWN, "Invalid Orange Money token response")
        self._token, self._token_expires_at = token, time.time() + int(payload.get("expires_in", 300)) - 30
        return token

    def _response(self, response: httpx.Response) -> dict[str, Any]:
        payload = response.json() if response.content else {}
        if not isinstance(payload, dict): payload = {}
        if response.is_error:
            error = self._map_error(response.status_code, payload.get("code"))
            raise ProviderError(error, str(payload.get("message", "Orange Money request failed")))
        return payload

    def _status(self, status: object) -> PaymentStatus:
        payment_status = {
            "ACCEPTED": PaymentStatus.SUCCESS,
            "SUCCESS": PaymentStatus.SUCCESS,
            "PENDING": PaymentStatus.PENDING,
            "INITIATED": PaymentStatus.PENDING,
            "CANCELLED": PaymentStatus.FAILED,
            "REJECTED": PaymentStatus.FAILED,
            "FAILED": PaymentStatus.FAILED,
        }.get(str(status).upper())
        if payment_status is None:
            raise ProviderError(PaymentError.UNKNOWN, "Unknown Orange Money payment status")
        return payment_status

    def _status_result(self, status: object, error_code: object) -> PaymentStatusResult:
        payment_status = self._status(status)
        return PaymentStatusResult(status=payment_status, error=self._map_error(200, error_code) if payment_status is PaymentStatus.FAILED else None)

    @staticmethod
    def _map_error(http_status: int, code: object) -> PaymentError:
        normalized_code = str(code if code is not None else http_status)
        return {"2020": PaymentError.INSUFFICIENT_FUNDS, "2021": PaymentError.INSUFFICIENT_FUNDS, "2000": PaymentError.INVALID_PHONE, "2001": PaymentError.INVALID_PHONE, "500": PaymentError.PROVIDER_TIMEOUT, "50": PaymentError.PROVIDER_TIMEOUT, "51": PaymentError.PROVIDER_TIMEOUT, "1": PaymentError.PROVIDER_TIMEOUT, "2": PaymentError.PROVIDER_TIMEOUT, "5": PaymentError.PROVIDER_TIMEOUT}.get(normalized_code, PaymentError.UNKNOWN)

    @staticmethod
    def _decode(raw_body: str | bytes) -> dict[str, Any]:
        payload = json.loads(raw_body)
        if not isinstance(payload, dict): raise ProviderError(PaymentError.UNKNOWN, "Invalid Orange Money webhook payload")
        return payload

    @staticmethod
    def _header(headers: WebhookHeaders, name: str) -> str | None:
        for key, value in headers.items():
            if key.lower() == name and isinstance(value, str): return value
        return None
