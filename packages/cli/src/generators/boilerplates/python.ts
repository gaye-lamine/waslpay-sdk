import type { Provider } from "../env.js";

export type PythonFramework = "fastapi" | "django";

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/** "orange-money" → "orange_money", "mtn-momo" → "mtn_momo" */
function pyVarName(provider: Provider): string {
  return provider.replace(/-/gu, "_");
}

function pyClassName(provider: Provider): string {
  switch (provider) {
    case "orange-money": return "OrangeMoneyProvider";
    case "mtn-momo": return "MtnMomoProvider";
    case "wave": return "WaveProvider";
  }
}

function pyImport(provider: Provider): string {
  switch (provider) {
    case "orange-money": return "from waslpay.providers.orange_money import OrangeMoneyProvider";
    case "mtn-momo": return "from waslpay.providers.mtn_momo import MtnMomoProvider";
    case "wave": return "from waslpay.providers.wave import WaveProvider";
  }
}

function checkoutPath(provider: Provider, multi: boolean): string {
  return multi ? `/checkout/${provider}` : "/checkout";
}

function webhookPath(provider: Provider, multi: boolean): string {
  return multi ? `/api/webhooks/waslpay/${provider}` : "/api/webhooks/waslpay";
}

function refundPath(provider: Provider, multi: boolean): string {
  return multi ? `/refund/${provider}/{session_id}` : "/refund/{session_id}";
}

function refundPathDjango(provider: Provider, multi: boolean): string {
  return multi ? `/refund/${provider}/<session_id>` : "/refund/<session_id>";
}

// ---------------------------------------------------------------------------
// Provider instantiation snippets
// ---------------------------------------------------------------------------

function pyProviderBlock(provider: Provider, multi: boolean): string {
  const v = pyVarName(provider);
  const clientVar = multi ? `${v}_client` : "client";
  const providerVar = multi ? `${v}_provider` : "provider";
  const waslpayVar = multi ? `waslpay_${v}` : "waslpay";

  let providerInit: string;
  switch (provider) {
    case "orange-money":
      providerInit = `OrangeMoneyProvider(
    ${clientVar},
    client_id=os.environ.get("ORANGE_MONEY_CLIENT_ID", ""),
    client_secret=os.environ.get("ORANGE_MONEY_CLIENT_SECRET", ""),
    merchant_code=os.environ.get("ORANGE_MONEY_MERCHANT_CODE", ""),
    sitename=os.environ.get("ORANGE_MONEY_SITENAME", ""),
    callback_url=os.environ.get("ORANGE_MONEY_CALLBACK_URL", "http://localhost:8000${webhookPath("orange-money", multi)}"),
    webhook_api_key=os.environ.get("ORANGE_MONEY_WEBHOOK_API_KEY", ""),
    environment=os.environ.get("ORANGE_MONEY_ENVIRONMENT", "sandbox"),
    base_url=os.environ.get("ORANGE_MONEY_BASE_URL"),
)`;
      break;
    case "mtn-momo":
      providerInit = `MtnMomoProvider(
    ${clientVar},
    subscription_key=os.environ.get("MTN_MOMO_SUBSCRIPTION_KEY", ""),
    api_user=os.environ.get("MTN_MOMO_API_USER", ""),
    api_key=os.environ.get("MTN_MOMO_API_KEY", ""),
    target_environment=os.environ.get("MTN_MOMO_TARGET_ENVIRONMENT", "sandbox"),
    base_url=os.environ.get("MTN_MOMO_BASE_URL"),
)`;
      break;
    case "wave":
    default:
      providerInit = `WaveProvider(
    ${clientVar},
    api_key=os.environ.get("WAVE_API_KEY", ""),
    webhook_secret=os.environ.get("WAVE_WEBHOOK_SECRET", ""),
    base_url=os.environ.get("WAVE_BASE_URL"),
)`;
  }

  return `${clientVar} = httpx.AsyncClient()
${providerVar} = ${providerInit}
${waslpayVar} = WaslPay(${providerVar})`;
}

// ---------------------------------------------------------------------------
// FastAPI routes
// ---------------------------------------------------------------------------

function fastapiRoutes(providers: readonly Provider[], multi: boolean): string {
  const routes: string[] = [];
  for (const p of providers) {
    const v = pyVarName(p);
    const waslpayVar = multi ? `waslpay_${v}` : "waslpay";
    const fnSuffix = multi ? `_${v}` : "";
    const chkPath = checkoutPath(p, multi);
    const wbkPath = webhookPath(p, multi);
    const refPath = refundPath(p, multi);

    routes.push(`@app.post("${chkPath}")
async def create_checkout${fnSuffix}():
    session = await ${waslpayVar}.initiate_payment(PaymentRequest(
        amount=1000,
        currency="XOF",
        reference="order-123",
        customer_phone="+221770000000",
    ))
    return session

@app.post("${wbkPath}")
async def webhook${fnSuffix}(request: Request):
    raw_body = await request.body()
    event = await ${waslpayVar}.handle_webhook(raw_body, dict(request.headers))
    return {"event_id": event.id}

@app.post("${refPath}")
async def refund${fnSuffix}(session_id: str):
    result = await ${waslpayVar}.refund(session_id, 1000)
    return result`);
  }
  return routes.join("\n\n");
}

// ---------------------------------------------------------------------------
// Django routes (view functions — routing wired in urls.py)
// ---------------------------------------------------------------------------

function djangoRoutes(providers: readonly Provider[], multi: boolean): string {
  const views: string[] = [];
  for (const p of providers) {
    const v = pyVarName(p);
    const waslpayVar = multi ? `waslpay_${v}` : "waslpay";
    const fnSuffix = multi ? `_${v}` : "";
    const chkPath = checkoutPath(p, multi);
    const wbkPath = webhookPath(p, multi);
    const refPath = refundPathDjango(p, multi);

    views.push(`# POST ${chkPath}
@csrf_exempt
async def create_checkout${fnSuffix}(request):
    session = await ${waslpayVar}.initiate_payment(PaymentRequest(
        amount=1000,
        currency="XOF",
        reference="order-123",
        customer_phone="+221770000000",
    ))
    return JsonResponse({"session_id": session.id, "payment_url": session.payment_url})

# POST ${wbkPath}
@csrf_exempt
async def webhook${fnSuffix}(request):
    raw_body = request.body
    event = await ${waslpayVar}.handle_webhook(raw_body, dict(request.headers.items()))
    return JsonResponse({"event_id": event.id})

# POST ${refPath}
@csrf_exempt
async def refund${fnSuffix}(request, session_id):
    result = await ${waslpayVar}.refund(session_id, 1000)
    return JsonResponse({"transaction_id": result.transaction_id, "status": result.status})`);
  }
  return views.join("\n\n");
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generatePythonBoilerplate(framework: PythonFramework, providers: readonly Provider[]): string {
  const multi = providers.length > 1;
  const header = `# Generated for ${framework}. Selected providers: ${providers.join(", ")}`;
  const imports = providers.map(pyImport).join("\n");
  const blocks = providers.map((p) => pyProviderBlock(p, multi)).join("\n\n");

  if (framework === "fastapi") {
    return `${header}
import os
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from waslpay import WaslPay, PaymentRequest
${imports}

load_dotenv()

app = FastAPI()

${blocks}

${fastapiRoutes(providers, multi)}
`;
  }

  // Django
  return `${header}
import os
import httpx
from dotenv import load_dotenv
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from waslpay import WaslPay, PaymentRequest
${imports}

load_dotenv()

${blocks}

${djangoRoutes(providers, multi)}
`;
}
