from __future__ import annotations

import base64
import json
import sys
import time
import uuid
from typing import Any

import httpx

from ..contracts import PaymentProvider, WebhookHeaders
from ..enums import PaymentError, PaymentStatus
from ..errors import ProviderError
from ..models import PaymentEvent, PaymentRequest, PaymentSession, PaymentStatusResult, RefundResult
from ..refund_validation import validate_refund_amount
from ..webhook_event_store import InMemoryWebhookEventStore, WebhookEventStore


class MtnMomoProvider(PaymentProvider):
    _BASE_URLS = {"sandbox": "https://sandbox.momodeveloper.mtn.com", "production": "https://proxy.momoapi.mtn.com"}

    def __init__(self, client: httpx.AsyncClient, subscription_key: str, api_user: str, api_key: str, target_environment: str = "sandbox", default_currency: str = "XOF", webhook_event_store: WebhookEventStore | None = None, base_url: str | None = None) -> None:
        self._client, self._subscription_key, self._api_user, self._api_key = client, subscription_key, api_user, api_key
        self._target_environment, self._default_currency, self._base_url = target_environment, default_currency, (base_url if base_url is not None else self._BASE_URLS[target_environment]).rstrip("/")
        self._token: str | None = None; self._token_expires_at = 0.0
        # A process-wide singleton would couple unrelated app instances; production must
        # inject durable storage shared by its webhook handling workers.
        self._webhook_event_store = (
            webhook_event_store
            if webhook_event_store is not None
            else InMemoryWebhookEventStore()
        )

    async def initiate_payment(self, params: PaymentRequest) -> PaymentSession:
        if not params.customer_phone: raise ProviderError(PaymentError.INVALID_PHONE, "MTN MoMo requires customer_phone")
        session_id = str(uuid.uuid4())
        await self._request("POST", "/collection/v1_0/requesttopay", session_id, json={"amount": str(params.amount), "currency": params.currency or self._default_currency, "externalId": params.reference, "payer": {"partyIdType": "MSISDN", "partyId": params.customer_phone}, "payerMessage": "Payment request", "payeeNote": params.reference})
        return PaymentSession(id=session_id, reference=params.reference, amount=params.amount, currency=params.currency or self._default_currency, status=PaymentStatus.PENDING)

    async def check_status(self, session_id: str) -> PaymentStatusResult:
        payload = await self._transaction(session_id)
        return self._status_result(payload.get("status"), payload.get("code"))

    async def handle_webhook(self, raw_body: str | bytes, headers: WebhookHeaders) -> PaymentEvent:
        if self._header(headers, "ocp-apim-subscription-key") != self._subscription_key: raise ProviderError(PaymentError.UNKNOWN, "Invalid MTN MoMo webhook security key")
        payload = self._decode(raw_body); session_id, status = payload.get("referenceId"), payload.get("status")
        if not isinstance(session_id, str): raise ProviderError(PaymentError.UNKNOWN, "Incomplete MTN MoMo webhook payload")
        payment_status = self._status(status)
        error = self._map_error(200, payload.get("code")) if payment_status is PaymentStatus.FAILED else None
        event = PaymentEvent(id=str(payload.get("id", session_id)), session_id=session_id, status=payment_status, occurred_at=str(payload.get("timestamp", "1970-01-01T00:00:00Z")), reference=payload.get("externalId") if isinstance(payload.get("externalId"), str) else None, error=error)
        return self._webhook_event_store.process(event, self._process_webhook_event)

    @staticmethod
    def _process_webhook_event(event: PaymentEvent) -> PaymentEvent:
        return event

    async def refund(self, session_id: str, amount: int | float | None = None) -> RefundResult:
        if amount is not None:
            amount = validate_refund_amount(
                amount,
                lambda code, message: ProviderError(code, message),
            )

        transaction = await self._transaction(session_id)
        original_amount = self._original_amount(transaction.get("amount"))

        if amount is not None and amount > original_amount:
            raise ProviderError(
                PaymentError.REFUND_AMOUNT_EXCEEDS_BALANCE,
                "Refund amount exceeds the original payment amount",
            )

        refund_amount = amount if amount is not None else original_amount
        refund_id = str(uuid.uuid4())
        await self._request("POST", "/collection/v1_0/refund", refund_id, json={"amount": str(refund_amount), "currency": self._default_currency, "externalId": session_id, "payerMessage": "Refund", "payeeNote": "Refund"})
        return RefundResult(session_id=session_id, refund_id=refund_id, amount=refund_amount, status=PaymentStatus.PENDING)

    async def _transaction(self, session_id: str) -> dict[str, Any]: return await self._request("GET", f"/collection/v1_0/requesttopay/{session_id}")
    async def _request(self, method: str, path: str, reference_id: str | None = None, **kwargs: Any) -> dict[str, Any]:
        token = await self._access_token(); headers = {"Authorization": f"Bearer {token}", "X-Target-Environment": self._target_environment, "Ocp-Apim-Subscription-Key": self._subscription_key}
        if reference_id: headers["X-Reference-Id"] = reference_id
        try: response = await self._client.request(method, self._base_url + path, headers=headers, **kwargs)
        except httpx.HTTPError as exc: raise ProviderError(PaymentError.PROVIDER_TIMEOUT, str(exc)) from exc
        return self._response(response)
    async def _access_token(self) -> str:
        if self._token and time.time() < self._token_expires_at: return self._token
        basic = base64.b64encode(f"{self._api_user}:{self._api_key}".encode()).decode(); response = await self._client.post(self._base_url + "/collection/token/", headers={"Authorization": f"Basic {basic}", "Ocp-Apim-Subscription-Key": self._subscription_key}); payload = self._response(response); token = payload.get("access_token")
        if not isinstance(token, str): raise ProviderError(PaymentError.UNKNOWN, "Invalid MTN MoMo token response")
        self._token, self._token_expires_at = token, time.time() + int(payload.get("expires_in", 300)) - 30; return token
    def _response(self, response: httpx.Response) -> dict[str, Any]:
        payload = response.json() if response.content else {}; payload = payload if isinstance(payload, dict) else {}
        if response.is_error:
            error = self._map_error(response.status_code, payload.get("code"))
            raise ProviderError(error, str(payload.get("message", "MTN MoMo request failed")))
        return payload
    @staticmethod
    def _status(status: object) -> PaymentStatus:
        payment_status = {
            "SUCCESSFUL": PaymentStatus.SUCCESS,
            "PENDING": PaymentStatus.PENDING,
            "FAILED": PaymentStatus.FAILED,
        }.get(str(status).upper())
        if payment_status is None:
            raise ProviderError(PaymentError.UNKNOWN, "Unknown MTN MoMo payment status")
        return payment_status
    @staticmethod
    def _original_amount(value: object) -> int:
        if isinstance(value, bool): raise ProviderError(PaymentError.UNKNOWN, "MTN MoMo response is missing original amount")
        if isinstance(value, int) and 0 < value <= sys.maxsize: return value
        if isinstance(value, str) and value.isdigit():
            parsed = int(value)
            if 0 < parsed <= sys.maxsize: return parsed
        raise ProviderError(PaymentError.UNKNOWN, "MTN MoMo response is missing original amount")
    def _status_result(self, status: object, error_code: object) -> PaymentStatusResult:
        payment_status = self._status(status)
        return PaymentStatusResult(status=payment_status, error=self._map_error(200, error_code) if payment_status is PaymentStatus.FAILED else None)
    @staticmethod
    def _map_error(http_status: int, code: object) -> PaymentError:
        normalized_code = str(code) if code is not None else ""
        if normalized_code in {"RESOURCE_NOT_FOUND", "PAYER_NOT_FOUND", "NOT_ENOUGH_FUNDS"}: return PaymentError.INSUFFICIENT_FUNDS
        if normalized_code in {"APPROVAL_REJECTED", "EXPIRED"}: return PaymentError.USER_CANCELLED
        if http_status >= 500 or http_status in {408, 429}: return PaymentError.PROVIDER_TIMEOUT
        return PaymentError.UNKNOWN
    @staticmethod
    def _decode(raw: str | bytes) -> dict[str, Any]:
        payload = json.loads(raw)
        if not isinstance(payload, dict): raise ProviderError(PaymentError.UNKNOWN, "Invalid MTN MoMo webhook payload")
        return payload
    @staticmethod
    def _header(headers: WebhookHeaders, name: str) -> str | None: return next((value for key, value in headers.items() if key.lower() == name and isinstance(value, str)), None)
