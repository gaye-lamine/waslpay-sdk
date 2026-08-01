from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable

import httpx
import pytest
import respx

from waslpay.contracts import PaymentProvider, WebhookHeaders
from waslpay.enums import PaymentError, PaymentStatus
from waslpay.errors import ProviderError
from waslpay.models import PaymentEvent, PaymentRequest
from waslpay.webhook_event_store import WebhookEventStore


class SpyWebhookEventStore(WebhookEventStore):
    def __init__(self) -> None:
        self._events: dict[str, PaymentEvent] = {}
        self.business_process_calls = 0

    def process(self, event: PaymentEvent, process_first_delivery: Callable[[PaymentEvent], PaymentEvent]) -> PaymentEvent:
        existing = self._events.get(event.id)
        if existing is not None:
            return existing

        self.business_process_calls += 1
        processed_event = process_first_delivery(event)
        self._events[event.id] = processed_event
        return processed_event


class ProviderContractTests(ABC):
    """Eight executable scenarios shared by every concrete provider test."""

    @abstractmethod
    def create_provider(self, client: httpx.AsyncClient, webhook_event_store: WebhookEventStore | None = None) -> PaymentProvider: ...

    @abstractmethod
    def install_http_mock(self) -> None: ...

    @property
    @abstractmethod
    def payment_request(self) -> PaymentRequest: ...

    @property
    @abstractmethod
    def failed_session_id(self) -> str: ...

    @property
    @abstractmethod
    def failed_payment_error(self) -> PaymentError: ...

    @property
    @abstractmethod
    def timeout_session_id(self) -> str: ...

    @property
    def api_error_session_id(self) -> str | None:
        return None

    @property
    def api_error_expected_error(self) -> PaymentError | None:
        return None

    @property
    @abstractmethod
    def valid_webhook(self) -> tuple[str, WebhookHeaders, PaymentEvent]: ...

    @property
    @abstractmethod
    def invalid_webhook(self) -> tuple[str, WebhookHeaders]: ...

    @property
    @abstractmethod
    def refund_supported(self) -> bool: ...

    @property
    @abstractmethod
    def refund_session_id(self) -> str: ...

    @property
    @abstractmethod
    def refund_original_amount(self) -> int: ...

    @property
    @abstractmethod
    def unusual_refund_session_id(self) -> str: ...

    @property
    @abstractmethod
    def unusual_refund_original_amount(self) -> int: ...

    @property
    @abstractmethod
    def refund_status(self) -> PaymentStatus: ...

    @property
    @abstractmethod
    def full_refund_amount(self) -> int: ...

    @property
    @abstractmethod
    def expiration_supported(self) -> bool: ...

    @property
    @abstractmethod
    def expiration_session_id(self) -> str: ...

    @property
    @abstractmethod
    def expired_webhook(self) -> tuple[str, WebhookHeaders, PaymentEvent] | None: ...

    @respx.mock
    @pytest.mark.asyncio
    async def test_initiate_payment_and_check_status_success(self) -> None:
        self.install_http_mock()
        async with httpx.AsyncClient() as client:
            provider = self.create_provider(client)
            session = await provider.initiate_payment(self.payment_request)
            assert session.id
            assert session.reference == self.payment_request.reference
            assert session.amount == self.payment_request.amount
            assert session.currency == self.payment_request.currency
            assert session.status is PaymentStatus.PENDING
            result = await provider.check_status(session.id)
            assert result.status is PaymentStatus.SUCCESS
            assert result.error is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_payment_failed_mapped_to_payment_error(self) -> None:
        self.install_http_mock()
        async with httpx.AsyncClient() as client:
            result = await self.create_provider(client).check_status(self.failed_session_id)
        assert result.status is PaymentStatus.FAILED
        assert result.error is self.failed_payment_error

    @property
    def failed_webhook(self) -> tuple[str, WebhookHeaders] | None:
        return None

    @pytest.mark.asyncio
    async def test_valid_webhook_returns_payment_event(self) -> None:
        raw_body, headers, expected = self.valid_webhook
        async with httpx.AsyncClient() as client:
            assert await self.create_provider(client).handle_webhook(raw_body, headers) == expected

    @pytest.mark.asyncio
    async def test_failed_webhook_returns_payment_event_with_error(self) -> None:
        if self.failed_webhook is None:
            pytest.skip("Provider has no failed webhook fixture")
        raw_body, headers = self.failed_webhook
        async with httpx.AsyncClient() as client:
            event = await self.create_provider(client).handle_webhook(raw_body, headers)
            assert event.status is PaymentStatus.FAILED
            assert event.error is not None

    @respx.mock
    @pytest.mark.asyncio
    async def test_api_error_code_field_mapped(self) -> None:
        session_id = self.api_error_session_id
        expected_error = self.api_error_expected_error
        if session_id is None or expected_error is None:
            pytest.skip("Provider has no API error code fixture")
        self.install_http_mock()
        async with httpx.AsyncClient() as client:
            with pytest.raises(ProviderError) as raised:
                await self.create_provider(client).check_status(session_id)
        assert raised.value.code is expected_error

    @respx.mock
    @pytest.mark.asyncio
    async def test_partial_refund(self) -> None:
        self.install_http_mock()
        async with httpx.AsyncClient() as client:
            provider = self.create_provider(client)
            if not self.refund_supported:
                with pytest.raises(NotImplementedError):
                    await provider.refund(self.refund_session_id, 500)
                return
            refund = await provider.refund(self.refund_session_id, 500)
        assert refund.session_id == self.refund_session_id
        assert refund.amount == 500
        assert refund.status is self.refund_status

    @respx.mock
    @pytest.mark.asyncio
    async def test_full_refund(self) -> None:
        self.install_http_mock()
        async with httpx.AsyncClient() as client:
            provider = self.create_provider(client)
            if not self.refund_supported:
                with pytest.raises(NotImplementedError):
                    await provider.refund(self.refund_session_id)
                return
            refund = await provider.refund(self.refund_session_id)
        assert refund.session_id == self.refund_session_id
        assert refund.amount == self.full_refund_amount
        assert refund.status is self.refund_status

    @pytest.mark.asyncio
    async def test_zero_refund_amount_is_rejected(self) -> None:
        await self._assert_invalid_refund_amount(0)

    @pytest.mark.asyncio
    async def test_negative_refund_amount_is_rejected(self) -> None:
        await self._assert_invalid_refund_amount(-1)

    @pytest.mark.asyncio
    async def test_decimal_refund_amount_is_rejected(self) -> None:
        await self._assert_invalid_refund_amount(1.5)

    @respx.mock
    @pytest.mark.asyncio
    async def test_refund_amount_exceeding_original_is_rejected(self) -> None:
        if not self.refund_supported:
            pytest.skip("Provider does not support refunds")
        self.install_http_mock()
        async with httpx.AsyncClient() as client:
            with pytest.raises(ProviderError) as raised:
                await self.create_provider(client).refund(
                    self.refund_session_id,
                    self.refund_original_amount + 1,
                )
        assert raised.value.code is PaymentError.REFUND_AMOUNT_EXCEEDS_BALANCE

    @respx.mock
    @pytest.mark.asyncio
    async def test_total_refund_is_exempt_from_amount_limit(self) -> None:
        if not self.refund_supported:
            pytest.skip("Provider does not support refunds")
        self.install_http_mock()
        async with httpx.AsyncClient() as client:
            refund = await self.create_provider(client).refund(self.unusual_refund_session_id)
        assert refund.session_id == self.unusual_refund_session_id
        assert refund.amount == self.unusual_refund_original_amount
        assert refund.status is self.refund_status

    @respx.mock
    @pytest.mark.asyncio
    async def test_expired_session(self) -> None:
        if not self.expiration_supported:
            pytest.skip("Provider does not support expired sessions")
        self.install_http_mock()
        async with httpx.AsyncClient() as client:
            provider = self.create_provider(client)
            result = await provider.check_status(self.expiration_session_id)
            assert result.status is PaymentStatus.EXPIRED
            assert result.error is None

            webhook = self.expired_webhook
            if webhook is not None:
                raw_body, headers, expected = webhook
                assert await provider.handle_webhook(raw_body, headers) == expected

    @respx.mock
    @pytest.mark.asyncio
    async def test_provider_timeout_mapped_correctly(self) -> None:
        self.install_http_mock()
        async with httpx.AsyncClient() as client:
            with pytest.raises(ProviderError) as raised:
                await self.create_provider(client).check_status(self.timeout_session_id)
        assert raised.value.code is PaymentError.PROVIDER_TIMEOUT

    @pytest.mark.asyncio
    async def test_webhook_delivered_twice(self) -> None:
        raw_body, headers, expected = self.valid_webhook
        async with httpx.AsyncClient() as client:
            store = SpyWebhookEventStore()
            provider = self.create_provider(client, store)
            first = await provider.handle_webhook(raw_body, headers)
            second = await provider.handle_webhook(raw_body, headers)
        assert first == expected
        assert second == first
        assert store.business_process_calls == 1

    async def _assert_invalid_refund_amount(self, amount: int | float) -> None:
        if not self.refund_supported:
            pytest.skip("Provider does not support refunds")
        async with httpx.AsyncClient() as client:
            with pytest.raises(ProviderError) as raised:
                await self.create_provider(client).refund(self.refund_session_id, amount)
        assert raised.value.code is PaymentError.INVALID_REFUND_AMOUNT
