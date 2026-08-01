from __future__ import annotations

import hashlib
import hmac
import json
import sys
from typing import Any, Literal, TypedDict, cast

import httpx

from ..contracts import PaymentProvider, WebhookHeaders
from ..enums import PaymentError, PaymentStatus
from ..errors import ProviderError
from ..models import PaymentEvent, PaymentRequest, PaymentSession, PaymentStatusResult, RefundResult
from ..refund_validation import validate_refund_amount
from ..webhook_event_store import InMemoryWebhookEventStore, WebhookEventStore


class WaveCheckoutSession(TypedDict, total=False):
    id: str
    amount: str | int
    client_reference: str | None
    wave_launch_url: str
    checkout_status: Literal["open", "complete", "expired"]
    payment_status: str
    error_code: str
    when_expires: str
    when_completed: str
    when_created: str


class WaveProvider(PaymentProvider):
    _BASE_URL = "https://api.wave.com/v1"

    def __init__(self, client: httpx.AsyncClient, api_key: str, webhook_secret: str, webhook_event_store: WebhookEventStore | None = None, base_url: str | None = None) -> None:
        self._client, self._api_key, self._webhook_secret = client, api_key, webhook_secret
        self._base_url = (base_url if base_url is not None else self._BASE_URL).rstrip("/")
        # The in-memory default is instance-local; inject durable shared storage in production.
        self._webhook_event_store = (
            webhook_event_store
            if webhook_event_store is not None
            else InMemoryWebhookEventStore()
        )

    async def initiate_payment(self, params: PaymentRequest) -> PaymentSession:
        payload = await self._request("POST", "/checkout/sessions", json={"amount": params.amount, "currency": "XOF", "error_url": params.failure_url, "success_url": params.success_url, "client_reference": params.reference})
        session_id = payload.get("id")
        if not isinstance(session_id, str): raise ProviderError(PaymentError.UNKNOWN, "Wave checkout response is missing id")
        return PaymentSession(id=session_id, reference=params.reference, amount=params.amount, currency=params.currency, status=PaymentStatus.PENDING, payment_url=payload.get("wave_launch_url") if isinstance(payload.get("wave_launch_url"), str) else None)

    async def check_status(self, session_id: str) -> PaymentStatusResult:
        session = await self._checkout_session(session_id)
        # checkout_status takes priority because payment_status has no documented expired value.
        if session.get("checkout_status") == "expired":
            return PaymentStatusResult(status=PaymentStatus.EXPIRED)
        return self._status_result(session.get("payment_status"), session.get("error_code"))

    async def handle_webhook(self, raw_body: str | bytes, headers: WebhookHeaders) -> PaymentEvent:
        raw = raw_body.encode() if isinstance(raw_body, str) else raw_body
        signature = self._header(headers, "x-wave-signature")
        expected = hmac.new(self._webhook_secret.encode(), raw, hashlib.sha256).hexdigest()
        candidates = [part.strip().removeprefix("v1=") for part in signature.split(",")] if signature else []
        if not any(hmac.compare_digest(expected, candidate) for candidate in candidates): raise ProviderError(PaymentError.UNKNOWN, "Invalid Wave webhook signature")
        payload = self._decode(raw); data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("id"), str): raise ProviderError(PaymentError.UNKNOWN, "Incomplete Wave webhook payload")
        event_type = payload.get("type")
        # Wave currently documents no dedicated webhook event type for expiration.
        # An expired checkout_status is therefore accepted before event-type mapping.
        status = (
            PaymentStatus.EXPIRED
            if data.get("checkout_status") == "expired"
            else PaymentStatus.SUCCESS if event_type == "checkout.session.completed"
            else PaymentStatus.FAILED if event_type == "checkout.session.payment_failed"
            else self._status(data.get("payment_status"))
        )
        error = self._map_error(200, data.get("error_code")) if status is PaymentStatus.FAILED else None
        event = PaymentEvent(id=str(payload.get("id", data["id"])), session_id=data["id"], status=status, occurred_at=str(data.get("when_completed", data.get("when_expires", data.get("when_created", "1970-01-01T00:00:00Z")))), reference=data.get("client_reference") if isinstance(data.get("client_reference"), str) else None, error=error)
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

        session = await self._checkout_session(session_id)
        original_amount = self._original_amount(session.get("amount"))

        if amount is not None and amount > original_amount:
            raise ProviderError(
                PaymentError.REFUND_AMOUNT_EXCEEDS_BALANCE,
                "Refund amount exceeds the original payment amount",
            )

        refund_amount = amount if amount is not None else original_amount
        payload = await self._request("POST", f"/checkout/sessions/{session_id}/refund", json={} if amount is None else {"amount": refund_amount})
        refund_id, refund_amount = payload.get("id"), payload.get("amount")
        if not isinstance(refund_id, str) or not isinstance(refund_amount, int): raise ProviderError(PaymentError.UNKNOWN, "Incomplete Wave refund response")
        return RefundResult(session_id=session_id, refund_id=refund_id, amount=refund_amount, status=self._status(payload.get("status", "succeeded")))

    async def _checkout_session(self, session_id: str) -> WaveCheckoutSession:
        return cast(WaveCheckoutSession, await self._request("GET", f"/checkout/sessions/{session_id}"))

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        try: response = await self._client.request(method, self._base_url + path, headers={"Authorization": f"Bearer {self._api_key}"}, **kwargs)
        except httpx.HTTPError as exc: raise ProviderError(PaymentError.PROVIDER_TIMEOUT, str(exc)) from exc
        payload = response.json() if response.content else {}; payload = payload if isinstance(payload, dict) else {}
        if response.is_error:
            error = self._map_error(response.status_code, payload.get("error_code", payload.get("code")))
            raise ProviderError(error, str(payload.get("error_message", payload.get("message", "Wave request failed"))))
        return payload

    @staticmethod
    def _status(status: object) -> PaymentStatus:
        payment_status = {
            "succeeded": PaymentStatus.SUCCESS,
            "success": PaymentStatus.SUCCESS,
            "processing": PaymentStatus.PENDING,
            "pending": PaymentStatus.PENDING,
            "cancelled": PaymentStatus.FAILED,
            "failed": PaymentStatus.FAILED,
        }.get(str(status).lower())
        if payment_status is None:
            raise ProviderError(PaymentError.UNKNOWN, "Unknown Wave payment status")
        return payment_status

    @staticmethod
    def _original_amount(value: object) -> int:
        if isinstance(value, bool):
            raise ProviderError(PaymentError.UNKNOWN, "Wave checkout response is missing a valid amount")
        if isinstance(value, int) and 0 < value <= sys.maxsize:
            return value
        if isinstance(value, str) and value.isdigit():
            parsed = int(value)
            if 0 < parsed <= sys.maxsize:
                return parsed
        raise ProviderError(PaymentError.UNKNOWN, "Wave checkout response is missing a valid amount")

    def _status_result(self, status: object, error_code: object) -> PaymentStatusResult:
        payment_status = self._status(status)
        return PaymentStatusResult(status=payment_status, error=self._map_error(200, error_code) if payment_status is PaymentStatus.FAILED else None)

    @staticmethod
    def _map_error(http_status: int, code: object) -> PaymentError:
        normalized_code = str(code) if code is not None else ""
        if normalized_code == "insufficient-funds": return PaymentError.INSUFFICIENT_FUNDS
        if normalized_code in {"payer-mobile-mismatch", "invalid-phone"}: return PaymentError.INVALID_PHONE
        if normalized_code in {"payment-cancelled", "user-cancelled"}: return PaymentError.USER_CANCELLED
        if http_status >= 500 or http_status in {408, 429}: return PaymentError.PROVIDER_TIMEOUT
        return PaymentError.UNKNOWN

    @staticmethod
    def _decode(raw: bytes) -> dict[str, Any]:
        payload = json.loads(raw)
        if not isinstance(payload, dict): raise ProviderError(PaymentError.UNKNOWN, "Invalid Wave webhook payload")
        return payload

    @staticmethod
    def _header(headers: WebhookHeaders, name: str) -> str | None:
        return next((value for key, value in headers.items() if key.lower() == name and isinstance(value, str)), None)
