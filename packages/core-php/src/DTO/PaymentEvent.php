<?php

declare(strict_types=1);

namespace WaslPay\Sdk\DTO;

use InvalidArgumentException;
use WaslPay\Sdk\Enums\PaymentError;
use WaslPay\Sdk\Enums\PaymentStatus;

final class PaymentEvent
{
    public function __construct(
        public readonly string $id,
        public readonly string $sessionId,
        public readonly PaymentStatus $status,
        public readonly string $occurredAt,
        public readonly ?string $reference = null,
        public readonly ?PaymentError $error = null,
    ) {
        if ($status === PaymentStatus::Failed && $error === null) {
            throw new InvalidArgumentException('A failed payment event requires a PaymentError.');
        }

        if ($status !== PaymentStatus::Failed && $error !== null) {
            throw new InvalidArgumentException('Only a failed payment event may include a PaymentError.');
        }
    }
}
