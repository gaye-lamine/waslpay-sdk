from __future__ import annotations

import httpx
import respx
import sys

from waslpay.enums import PaymentError, PaymentStatus
from waslpay.models import PaymentEvent, PaymentRequest
from waslpay.providers.orange_money import OrangeMoneyProvider
from waslpay.webhook_event_store import WebhookEventStore
from tests.contract import ProviderContractTests


class TestOrangeMoneyProvider(ProviderContractTests):
    def create_provider(self, client: httpx.AsyncClient, webhook_event_store: WebhookEventStore | None = None) -> OrangeMoneyProvider:
        return OrangeMoneyProvider(client, "id", "secret", "merchant", "site", "https://merchant.test/callback", "webhook-key", webhook_event_store=webhook_event_store)

    def install_http_mock(self) -> None:
        base = "https://api.sandbox.orange-sonatel.com"
        respx.post(base + "/oauth/v1/token").mock(return_value=httpx.Response(200, json={"access_token": "token", "expires_in": 3600}))
        respx.post(base + "/v1/onlinePayment/prepare").mock(return_value=httpx.Response(200, json={"paymentUrl": "https://orange.test/pay"}))
        def transaction(request: httpx.Request) -> httpx.Response:
            reference = request.url.params.get("reference")
            if reference == self.timeout_session_id:
                return httpx.Response(503, json={"code": 500})
            return httpx.Response(200, json={"transactions": [{"status": "FAILED" if reference == self.failed_session_id else "SUCCESS", **({"code": 2020} if reference == self.failed_session_id else {})}]})
        respx.get(base + "/api/eWallet/v1/transactions").mock(side_effect=transaction)

    @property
    def payment_request(self) -> PaymentRequest: return PaymentRequest(amount=1000, currency="XOF", reference="contract-success")
    @property
    def failed_session_id(self) -> str: return "contract-failed"
    @property
    def failed_payment_error(self) -> PaymentError: return PaymentError.INSUFFICIENT_FUNDS
    @property
    def timeout_session_id(self) -> str: return "contract-timeout"
    @property
    def valid_webhook(self) -> tuple[str, dict[str, str], PaymentEvent]:
        raw = '{"transactionId":"orange-1","reference":"contract-success","status":"SUCCESS","timestamp":"2026-07-21T12:00:00Z"}'
        return raw, {"x-api-key": "webhook-key"}, PaymentEvent(id="orange-1", session_id="contract-success", status=PaymentStatus.SUCCESS, reference="contract-success", occurred_at="2026-07-21T12:00:00Z")
    @property
    def failed_webhook(self) -> tuple[str, dict[str, str]]:
        return '{"transactionId":"orange-failed","reference":"contract-failed","status":"FAILED","code":"2020"}', {"x-api-key": "webhook-key"}
    @property
    def invalid_webhook(self) -> tuple[str, dict[str, str]]: return "{}", {"x-api-key": "invalid"}
    @property
    def refund_supported(self) -> bool: return False
    @property
    def refund_session_id(self) -> str: return "contract-success"
    @property
    def refund_original_amount(self) -> int: return 1000
    @property
    def unusual_refund_session_id(self) -> str: return "orange-unusual"
    @property
    def unusual_refund_original_amount(self) -> int: return sys.maxsize
    @property
    def refund_status(self) -> PaymentStatus: return PaymentStatus.FAILED
    @property
    def full_refund_amount(self) -> int: return 1000
    @property
    def expiration_supported(self) -> bool: return False
    @property
    def expiration_session_id(self) -> str: return "orange-expired-unsupported"
    @property
    def expired_webhook(self) -> tuple[str, dict[str, str], PaymentEvent] | None: return None
