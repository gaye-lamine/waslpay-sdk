import type { Provider } from "../env.js";

export type PhpFramework = "laravel" | "symfony" | "native";

function getProviderCodePhp(provider: Provider): { importClass: string; code: string } {
  switch (provider) {
    case "orange-money":
      return {
        importClass: "WaslPay\\Sdk\\Providers\\OrangeMoneyProvider",
        code: `$httpClient = new Client();
$provider = new OrangeMoneyProvider(
    $httpClient,
    getenv('ORANGE_MONEY_CLIENT_ID') ?: '',
    getenv('ORANGE_MONEY_CLIENT_SECRET') ?: '',
    getenv('ORANGE_MONEY_MERCHANT_CODE') ?: '',
    getenv('ORANGE_MONEY_SITENAME') ?: '',
    getenv('ORANGE_MONEY_CALLBACK_URL') ?: 'http://localhost:8000/api/webhooks/waslpay',
    getenv('ORANGE_MONEY_WEBHOOK_API_KEY') ?: '',
    getenv('ORANGE_MONEY_ENVIRONMENT') ?: 'sandbox',
    null,
    getenv('ORANGE_MONEY_BASE_URL') ?: null
);`,
      };
    case "mtn-momo":
      return {
        importClass: "WaslPay\\Sdk\\Providers\\MtnMomoProvider",
        code: `$httpClient = new Client();
$provider = new MtnMomoProvider(
    $httpClient,
    getenv('MTN_MOMO_SUBSCRIPTION_KEY') ?: '',
    getenv('MTN_MOMO_API_USER') ?: '',
    getenv('MTN_MOMO_API_KEY') ?: '',
    getenv('MTN_MOMO_TARGET_ENVIRONMENT') ?: 'sandbox',
    'XOF',
    null,
    getenv('MTN_MOMO_BASE_URL') ?: null
);`,
      };
    case "wave":
    default:
      return {
        importClass: "WaslPay\\Sdk\\Providers\\WaveProvider",
        code: `$httpClient = new Client();
$provider = new WaveProvider(
    $httpClient,
    getenv('WAVE_API_KEY') ?: '',
    getenv('WAVE_WEBHOOK_SECRET') ?: '',
    null,
    getenv('WAVE_BASE_URL') ?: null
);`,
      };
  }
}

export function generatePhpBoilerplate(framework: PhpFramework, providers: readonly Provider[]): string {
  const primaryProvider = providers[0] ?? "wave";
  const { importClass, code } = getProviderCodePhp(primaryProvider);

  if (framework === "laravel") {
    return `<?php

declare(strict_types=1);

// Generated for ${framework}. Selected providers: ${providers.join(", ")}
namespace App\\Http\\Controllers;

use GuzzleHttp\\Client;
use Illuminate\\Http\\Request;
use WaslPay\\Sdk\\DTO\\PaymentRequest;
use WaslPay\\Sdk\\WaslPay;
use ${importClass};

class PaymentController
{
    private WaslPay $waslPay;

    public function __construct()
    {
        ${code}
        $this->waslPay = new WaslPay($provider);
    }

    public function checkout()
    {
        $session = $this->waslPay->initiatePayment(
            new PaymentRequest(1000, 'XOF', 'order-123', '+221770000000')
        );

        return response()->json($session);
    }

    public function webhook(Request $request)
    {
        $event = $this->waslPay->handleWebhook(
            $request->getContent(),
            $request->headers->all()
        );

        return response()->json(['event_id' => $event->id]);
    }
}
`;
  }

  if (framework === "symfony") {
    return `<?php

declare(strict_types=1);

// Generated for ${framework}. Selected providers: ${providers.join(", ")}
namespace App\\Controller;

use GuzzleHttp\\Client;
use Symfony\\Bundle\\FrameworkBundle\\Controller\\AbstractController;
use Symfony\\Component\\HttpFoundation\\JsonResponse;
use Symfony\\Component\\HttpFoundation\\Request;
use WaslPay\\Sdk\\DTO\\PaymentRequest;
use WaslPay\\Sdk\\WaslPay;
use ${importClass};

class PaymentController extends AbstractController
{
    private WaslPay $waslPay;

    public function __construct()
    {
        ${code}
        $this->waslPay = new WaslPay($provider);
    }

    public function checkout(): JsonResponse
    {
        $session = $this->waslPay->initiatePayment(
            new PaymentRequest(1000, 'XOF', 'order-123', '+221770000000')
        );

        return $this->json($session);
    }

    public function webhook(Request $request): JsonResponse
    {
        $event = $this->waslPay->handleWebhook(
            $request->getContent(),
            $request->headers->all()
        );

        return $this->json(['event_id' => $event->id]);
    }
}
`;
  }

  // Native PHP
  return `<?php

declare(strict_types=1);

// Generated for ${framework}. Selected providers: ${providers.join(", ")}
use GuzzleHttp\\Client;
use WaslPay\\Sdk\\DTO\\PaymentRequest;
use WaslPay\\Sdk\\WaslPay;
use ${importClass};

${code}
$waslPay = new WaslPay($provider);

// Checkout endpoint example
$session = $waslPay->initiatePayment(
    new PaymentRequest(1000, 'XOF', 'order-123', '+221770000000')
);

// Webhook endpoint (/api/webhooks/waslpay): pass untouched request body and headers
$rawBody = file_get_contents('php://input');
$headers = function_exists('getallheaders') ? getallheaders() : [];
$event = $waslPay->handleWebhook($rawBody, $headers);
`;
}
