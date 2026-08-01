from __future__ import annotations

import hashlib
import hmac
import json
import sys

import httpx
import respx

from waslpay.enums import PaymentError, PaymentStatus
from waslpay.models import PaymentEvent, PaymentRequest
from waslpay.providers.wave import WaveProvider
from waslpay.webhook_event_store import WebhookEventStore
from tests.contract import ProviderContractTests


class TestWaveProvider(ProviderContractTests):
    def create_provider(self, client: httpx.AsyncClient, webhook_event_store: WebhookEventStore | None = None) -> WaveProvider: return WaveProvider(client, "key", "secret", webhook_event_store)

    def install_http_mock(self) -> None:
        base = "https://api.wave.com/v1"
        respx.post(base + "/checkout/sessions").mock(return_value=httpx.Response(200, json={"id": "wave-1", "wave_launch_url": "https://wave.test/pay"}))
        def checkout(request: httpx.Request) -> httpx.Response:
            session_id = request.url.path.rsplit("/", 1)[-1]
            if session_id == self.timeout_session_id: return httpx.Response(503, json={})
            if session_id == self.api_error_session_id:
                return httpx.Response(400, json={"code": "insufficient-funds", "message": "Wave code field error"})
            return httpx.Response(200, json={
                "amount": sys.maxsize if session_id == self.unusual_refund_session_id else 1000,
                **(
                    {"checkout_status": "expired", "payment_status": "processing", "when_expires": "2026-07-22T12:00:00Z"}
                    if session_id == self.expiration_session_id
                    else {"payment_status": "cancelled" if session_id == self.failed_session_id else "succeeded"}
                ),
                **({"error_code": "insufficient-funds"} if session_id == self.failed_session_id else {}),
            })
        respx.get(url__regex=base + r"/checkout/sessions/[^/]+$").mock(side_effect=checkout)
        def refund(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content) if request.content else {}
            amount = body.get("amount", sys.maxsize if "wave-unusual" in request.url.path else 1000)
            return httpx.Response(200, json={"id": "refund", "amount": amount, "status": "succeeded"})
        respx.post(url__regex=base + r"/checkout/sessions/[^/]+/refund$").mock(side_effect=refund)

    @property
    def payment_request(self) -> PaymentRequest: return PaymentRequest(amount=1000, currency="XOF", reference="contract-success")
    @property
    def failed_session_id(self) -> str: return "contract-failed"
    @property
    def failed_payment_error(self) -> PaymentError: return PaymentError.INSUFFICIENT_FUNDS
    @property
    def timeout_session_id(self) -> str: return "contract-timeout"
    @property
    def api_error_session_id(self) -> str: return "wave-api-error"
    @property
    def api_error_expected_error(self) -> PaymentError: return PaymentError.INSUFFICIENT_FUNDS
    @property
    def valid_webhook(self) -> tuple[str, dict[str, str], PaymentEvent]:
        raw = '{"id":"event-1","type":"checkout.session.completed","data":{"id":"wave-1","client_reference":"contract-success","payment_status":"succeeded","when_completed":"2026-07-21T12:00:00Z"}}'
        signature = hmac.new(b"secret", raw.encode(), hashlib.sha256).hexdigest()
        return raw, {"x-wave-signature": signature}, PaymentEvent(id="event-1", session_id="wave-1", status=PaymentStatus.SUCCESS, occurred_at="2026-07-21T12:00:00Z", reference="contract-success")

    @property
    def failed_webhook(self) -> tuple[str, dict[str, str]]:
        raw = '{"id":"event-failed","type":"checkout.session.payment_failed","data":{"id":"wave-failed","client_reference":"contract-failed","payment_status":"cancelled","when_completed":"2026-07-21T12:00:00Z"}}'
        signature = hmac.new(b"secret", raw.encode(), hashlib.sha256).hexdigest()
        return raw, {"x-wave-signature": signature}
    @property
    def invalid_webhook(self) -> tuple[str, dict[str, str]]: return "{}", {"x-wave-signature": "invalid"}
    @property
    def refund_supported(self) -> bool: return True
    @property
    def refund_session_id(self) -> str: return "contract-success"
    @property
    def refund_original_amount(self) -> int: return 1000
    @property
    def unusual_refund_session_id(self) -> str: return "wave-unusual"
    @property
    def unusual_refund_original_amount(self) -> int: return sys.maxsize
    @property
    def refund_status(self) -> PaymentStatus: return PaymentStatus.SUCCESS
    @property
    def full_refund_amount(self) -> int: return 1000
    @property
    def expiration_supported(self) -> bool: return True
    @property
    def expiration_session_id(self) -> str: return "wave-expired"
    @property
    def expired_webhook(self) -> tuple[str, dict[str, str], PaymentEvent]:
        raw = '{"id":"event-expired","type":"checkout.session.updated","data":{"id":"wave-expired","client_reference":"contract-expired","checkout_status":"expired","payment_status":"processing","when_expires":"2026-07-22T12:00:00Z"}}'
        signature = hmac.new(b"secret", raw.encode(), hashlib.sha256).hexdigest()
        return raw, {"x-wave-signature": signature}, PaymentEvent(id="event-expired", session_id="wave-expired", status=PaymentStatus.EXPIRED, reference="contract-expired", occurred_at="2026-07-22T12:00:00Z")
