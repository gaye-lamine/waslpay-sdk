import type { Provider } from "../env.js";

export type PhpFramework = "laravel" | "symfony" | "native";

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/** "orange-money" → "OrangeMoney", "mtn-momo" → "MtnMomo", "wave" → "Wave" */
function phpSuffix(provider: Provider): string {
  return provider.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

function phpClassName(provider: Provider): string {
  switch (provider) {
    case "orange-money": return "OrangeMoneyProvider";
    case "mtn-momo": return "MtnMomoProvider";
    case "wave": return "WaveProvider";
  }
}

function phpUseStatement(provider: Provider): string {
  switch (provider) {
    case "orange-money": return "use WaslPay\\Sdk\\Providers\\OrangeMoneyProvider;";
    case "mtn-momo": return "use WaslPay\\Sdk\\Providers\\MtnMomoProvider;";
    case "wave": return "use WaslPay\\Sdk\\Providers\\WaveProvider;";
  }
}

function checkoutPath(provider: Provider, multi: boolean): string {
  return multi ? `/checkout/${provider}` : "/checkout";
}

function webhookPath(provider: Provider, multi: boolean): string {
  return multi ? `/api/webhooks/waslpay/${provider}` : "/api/webhooks/waslpay";
}

// ---------------------------------------------------------------------------
// Provider instantiation snippets
// ---------------------------------------------------------------------------

function phpProviderBlock(provider: Provider, multi: boolean): string {
  const suffix = phpSuffix(provider);
  const clientVar = multi ? `$httpClient${suffix}` : "$httpClient";
  const providerVar = multi ? `$provider${suffix}` : "$provider";
  const waslpayVar = multi ? `$waslPay${suffix}` : "$waslPay";

  let ctorArgs: string;
  switch (provider) {
    case "orange-money":
      ctorArgs = `${clientVar},
    getenv('ORANGE_MONEY_CLIENT_ID') ?: '',
    getenv('ORANGE_MONEY_CLIENT_SECRET') ?: '',
    getenv('ORANGE_MONEY_MERCHANT_CODE') ?: '',
    getenv('ORANGE_MONEY_SITENAME') ?: '',
    getenv('ORANGE_MONEY_CALLBACK_URL') ?: 'http://localhost:8000${webhookPath("orange-money", multi)}',
    getenv('ORANGE_MONEY_WEBHOOK_API_KEY') ?: '',
    getenv('ORANGE_MONEY_ENVIRONMENT') ?: 'sandbox',
    null,
    getenv('ORANGE_MONEY_BASE_URL') ?: null`;
      break;
    case "mtn-momo":
      ctorArgs = `${clientVar},
    getenv('MTN_MOMO_SUBSCRIPTION_KEY') ?: '',
    getenv('MTN_MOMO_API_USER') ?: '',
    getenv('MTN_MOMO_API_KEY') ?: '',
    getenv('MTN_MOMO_TARGET_ENVIRONMENT') ?: 'sandbox',
    'XOF',
    null,
    getenv('MTN_MOMO_BASE_URL') ?: null`;
      break;
    case "wave":
    default:
      ctorArgs = `${clientVar},
    getenv('WAVE_API_KEY') ?: '',
    getenv('WAVE_WEBHOOK_SECRET') ?: '',
    null,
    getenv('WAVE_BASE_URL') ?: null`;
  }

  return `${clientVar} = new Client();
${providerVar} = new ${phpClassName(provider)}(
    ${ctorArgs}
);
${waslpayVar} = new WaslPay(${providerVar});`;
}

// ---------------------------------------------------------------------------
// Laravel
// ---------------------------------------------------------------------------

function laravelClass(providers: readonly Provider[], multi: boolean): string {
  const properties = multi
    ? providers.map((p) => `    private WaslPay $waslPay${phpSuffix(p)};`).join("\n")
    : "    private WaslPay $waslPay;";

  const ctorBody = multi
    ? providers.map((p) => {
        const block = phpProviderBlock(p, true);
        // indent lines 2+ by 8 spaces to fit inside constructor
        return block.split("\n").map((l, i) => (i === 0 ? `        ${l}` : `        ${l}`)).join("\n") +
               `\n        $this->waslPay${phpSuffix(p)} = $waslPay${phpSuffix(p)};`;
      }).join("\n\n")
    : phpProviderBlock(providers[0] ?? "wave", false).split("\n").map((l) => `        ${l}`).join("\n") +
      `\n        $this->waslPay = $waslPay;`;

  const methods = multi
    ? providers.map((p) => {
        const suffix = phpSuffix(p);
        const waslpayVar = `$this->waslPay${suffix}`;
        const chkPath = checkoutPath(p, true);
        const wbkPath = webhookPath(p, true);
        return `    public function checkout${suffix}()
    {
        $session = ${waslpayVar}->initiatePayment(
            new PaymentRequest(1000, 'XOF', 'order-123', '+221770000000')
        );
        return response()->json($session);
    }

    public function webhook${suffix}(Request $request)
    {
        $event = ${waslpayVar}->handleWebhook(
            $request->getContent(),
            $request->headers->all()
        );
        return response()->json(['event_id' => $event->id]);
    }
    // Route: POST ${chkPath}  ->  checkout${suffix}()
    // Route: POST ${wbkPath}  ->  webhook${suffix}()`;
      }).join("\n\n")
    : `    public function checkout()
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
    }`;

  return `${properties}

    public function __construct()
    {
${ctorBody}
    }

${methods}`;
}

// ---------------------------------------------------------------------------
// Symfony
// ---------------------------------------------------------------------------

function symfonyClass(providers: readonly Provider[], multi: boolean): string {
  const properties = multi
    ? providers.map((p) => `    private WaslPay $waslPay${phpSuffix(p)};`).join("\n")
    : "    private WaslPay $waslPay;";

  const ctorBody = multi
    ? providers.map((p) => {
        const block = phpProviderBlock(p, true);
        return block.split("\n").map((l) => `        ${l}`).join("\n") +
               `\n        $this->waslPay${phpSuffix(p)} = $waslPay${phpSuffix(p)};`;
      }).join("\n\n")
    : phpProviderBlock(providers[0] ?? "wave", false).split("\n").map((l) => `        ${l}`).join("\n") +
      `\n        $this->waslPay = $waslPay;`;

  const methods = multi
    ? providers.map((p) => {
        const suffix = phpSuffix(p);
        const waslpayVar = `$this->waslPay${suffix}`;
        const chkPath = checkoutPath(p, true);
        const wbkPath = webhookPath(p, true);
        return `    public function checkout${suffix}(): JsonResponse
    {
        $session = ${waslpayVar}->initiatePayment(
            new PaymentRequest(1000, 'XOF', 'order-123', '+221770000000')
        );
        return $this->json($session);
    }

    public function webhook${suffix}(Request $request): JsonResponse
    {
        $event = ${waslpayVar}->handleWebhook(
            $request->getContent(),
            $request->headers->all()
        );
        return $this->json(['event_id' => $event->id]);
    }
    // Route: POST ${chkPath}  ->  checkout${suffix}()
    // Route: POST ${wbkPath}  ->  webhook${suffix}()`;
      }).join("\n\n")
    : `    public function checkout(): JsonResponse
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
    }`;

  return `${properties}

    public function __construct()
    {
${ctorBody}
    }

${methods}`;
}

// ---------------------------------------------------------------------------
// Native PHP
// ---------------------------------------------------------------------------

function nativePhp(providers: readonly Provider[], multi: boolean): string {
  const blocks = providers.map((p) => phpProviderBlock(p, multi)).join("\n\n");

  if (!multi) {
    const wbkPath = webhookPath(providers[0] ?? "wave", false);
    return `${blocks}

/*
 * Checkout endpoint example: POST /checkout
 * $session = $waslPay->initiatePayment(
 *     new PaymentRequest(1000, 'XOF', 'order-123', '+221770000000')
 * );
 *
 * Webhook endpoint (${wbkPath}): pass untouched request body and headers
 * $rawBody = file_get_contents('php://input');
 * $headers = function_exists('getallheaders') ? getallheaders() : [];
 * $event = $waslPay->handleWebhook($rawBody, $headers);
 */`;
  }

  // Multi-provider: show each instance with its dedicated routes as comments.
  const usageBlocks = providers.map((p) => {
    const suffix = phpSuffix(p);
    const chkPath = checkoutPath(p, true);
    const wbkPath = webhookPath(p, true);
    return `/*
 * --- ${phpClassName(p)} ---
 * POST ${chkPath}
 * $session${suffix} = $waslPay${suffix}->initiatePayment(
 *     new PaymentRequest(1000, 'XOF', 'order-${p}', '+221770000000')
 * );
 * POST ${wbkPath}
 * $rawBody${suffix} = file_get_contents('php://input');
 * $headers${suffix} = function_exists('getallheaders') ? getallheaders() : [];
 * $event${suffix} = $waslPay${suffix}->handleWebhook($rawBody${suffix}, $headers${suffix});
 */`;
  }).join("\n\n");

  return `${blocks}

${usageBlocks}`;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generatePhpBoilerplate(framework: PhpFramework, providers: readonly Provider[]): string {
  const multi = providers.length > 1;
  const header = `// Generated for ${framework}. Selected providers: ${providers.join(", ")}`;
  const uses = providers.map(phpUseStatement).join("\n");

  if (framework === "laravel") {
    return `<?php

declare(strict_types=1);

${header}
namespace App\\Http\\Controllers;

use GuzzleHttp\\Client;
use Illuminate\\Http\\Request;
use WaslPay\\Sdk\\DTO\\PaymentRequest;
use WaslPay\\Sdk\\WaslPay;
${uses}

class PaymentController
{
${laravelClass(providers, multi)}
}
`;
  }

  if (framework === "symfony") {
    return `<?php

declare(strict_types=1);

${header}
namespace App\\Controller;

use GuzzleHttp\\Client;
use Symfony\\Bundle\\FrameworkBundle\\Controller\\AbstractController;
use Symfony\\Component\\HttpFoundation\\JsonResponse;
use Symfony\\Component\\HttpFoundation\\Request;
use WaslPay\\Sdk\\DTO\\PaymentRequest;
use WaslPay\\Sdk\\WaslPay;
${uses}

class PaymentController extends AbstractController
{
${symfonyClass(providers, multi)}
}
`;
  }

  // Native PHP
  return `<?php

declare(strict_types=1);

${header}
use GuzzleHttp\\Client;
use WaslPay\\Sdk\\DTO\\PaymentRequest;
use WaslPay\\Sdk\\WaslPay;
${uses}

require_once __DIR__ . '/vendor/autoload.php';

${nativePhp(providers, multi)}
`;
}
