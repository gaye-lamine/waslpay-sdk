from __future__ import annotations

import httpx
import respx
import sys

from waslpay.enums import PaymentError, PaymentStatus
from waslpay.models import PaymentEvent, PaymentRequest
from waslpay.providers.mtn_momo import MtnMomoProvider
from waslpay.webhook_event_store import WebhookEventStore
from tests.contract import ProviderContractTests


class TestMtnMomoProvider(ProviderContractTests):
    def create_provider(self, client: httpx.AsyncClient, webhook_event_store: WebhookEventStore | None = None) -> MtnMomoProvider:
        return MtnMomoProvider(client, "subscription-key", "3fa85f64-5717-4562-b3fc-2c963f66afa6", "api-key", webhook_event_store=webhook_event_store)

    def install_http_mock(self) -> None:
        base = "https://sandbox.momodeveloper.mtn.com"
        respx.post(base + "/collection/token/").mock(return_value=httpx.Response(200, json={"access_token": "token", "expires_in": 3600}))
        respx.post(base + "/collection/v1_0/requesttopay").mock(return_value=httpx.Response(202))
        def transaction(request: httpx.Request) -> httpx.Response:
            session_id = request.url.path.rsplit("/", 1)[-1]
            if session_id == self.timeout_session_id: return httpx.Response(503, json={})
            return httpx.Response(200, json={"status": "FAILED" if session_id == self.failed_session_id else "SUCCESSFUL", "amount": str(sys.maxsize if session_id == self.unusual_refund_session_id else 1000), **({"code": "NOT_ENOUGH_FUNDS"} if session_id == self.failed_session_id else {})})
        respx.get(url__regex=base + r"/collection/v1_0/requesttopay/[^/]+$").mock(side_effect=transaction)
        respx.post(base + "/collection/v1_0/refund").mock(return_value=httpx.Response(202))

    @property
    def payment_request(self) -> PaymentRequest: return PaymentRequest(amount=1000, currency="XOF", reference="contract-success", customer_phone="+221770000000")
    @property
    def failed_session_id(self) -> str: return "contract-failed"
    @property
    def failed_payment_error(self) -> PaymentError: return PaymentError.INSUFFICIENT_FUNDS
    @property
    def timeout_session_id(self) -> str: return "contract-timeout"
    @property
    def valid_webhook(self) -> tuple[str, dict[str, str], PaymentEvent]:
        raw = '{"referenceId":"mtn-1","externalId":"contract-success","status":"SUCCESSFUL","timestamp":"2026-07-21T12:00:00Z"}'
        return raw, {"ocp-apim-subscription-key": "subscription-key"}, PaymentEvent(id="mtn-1", session_id="mtn-1", status=PaymentStatus.SUCCESS, reference="contract-success", occurred_at="2026-07-21T12:00:00Z")
    @property
    def failed_webhook(self) -> tuple[str, dict[str, str]]:
        return '{"referenceId":"mtn-failed","externalId":"contract-failed","status":"FAILED","code":"NOT_ENOUGH_FUNDS"}', {"ocp-apim-subscription-key": "subscription-key"}
    @property
    def invalid_webhook(self) -> tuple[str, dict[str, str]]: return "{}", {"ocp-apim-subscription-key": "invalid"}
    @property
    def refund_supported(self) -> bool: return True
    @property
    def refund_session_id(self) -> str: return "contract-success"
    @property
    def refund_original_amount(self) -> int: return 1000
    @property
    def unusual_refund_session_id(self) -> str: return "mtn-unusual"
    @property
    def unusual_refund_original_amount(self) -> int: return sys.maxsize
    @property
    def refund_status(self) -> PaymentStatus: return PaymentStatus.PENDING
    @property
    def full_refund_amount(self) -> int: return 1000
    @property
    def expiration_supported(self) -> bool: return False
    @property
    def expiration_session_id(self) -> str: return "mtn-expired-unsupported"
    @property
    def expired_webhook(self) -> tuple[str, dict[str, str], PaymentEvent] | None: return None
