import type { Provider } from "../env.js";

export type PythonFramework = "fastapi" | "django";

function getProviderCodePython(provider: Provider): { importStmt: string; code: string } {
  switch (provider) {
    case "orange-money":
      return {
        importStmt: "from waslpay.providers.orange_money import OrangeMoneyProvider",
        code: `provider = OrangeMoneyProvider(
    auth_header=os.environ.get("ORANGE_MONEY_AUTH_HEADER", ""),
    merchant_key=os.environ.get("ORANGE_MONEY_MERCHANT_KEY", ""),
    base_url=os.environ.get("ORANGE_MONEY_BASE_URL"),
)`,
      };
    case "mtn-momo":
      return {
        importStmt: "from waslpay.providers.mtn_momo import MtnMomoProvider",
        code: `provider = MtnMomoProvider(
    subscription_key=os.environ.get("MTN_MOMO_SUBSCRIPTION_KEY", ""),
    api_user=os.environ.get("MTN_MOMO_API_USER", ""),
    api_key=os.environ.get("MTN_MOMO_API_KEY", ""),
    target_environment=os.environ.get("MTN_MOMO_TARGET_ENVIRONMENT", "sandbox"),
    base_url=os.environ.get("MTN_MOMO_BASE_URL"),
)`,
      };
    case "wave":
    default:
      return {
        importStmt: "from waslpay.providers.wave import WaveProvider",
        code: `provider = WaveProvider(
    api_key=os.environ.get("WAVE_API_KEY", ""),
    webhook_secret=os.environ.get("WAVE_WEBHOOK_SECRET", ""),
    base_url=os.environ.get("WAVE_BASE_URL"),
)`,
      };
  }
}

export function generatePythonBoilerplate(framework: PythonFramework, providers: readonly Provider[]): string {
  const primaryProvider = providers[0] ?? "wave";
  const { importStmt, code } = getProviderCodePython(primaryProvider);

  if (framework === "fastapi") {
    return `# Generated for ${framework}. Selected providers: ${providers.join(", ")}
import os
from fastapi import FastAPI, Request
from waslpay import WaslPay, PaymentRequest
${importStmt}

app = FastAPI()

${code}
waslpay = WaslPay(provider)

@app.post("/checkout")
async def create_checkout():
    session = await waslpay.initiate_payment(PaymentRequest(
        amount=1000,
        currency="XOF",
        reference="order-123",
        customer_phone="+221770000000",
    ))
    return session

@app.post("/webhooks/payments")
async def webhook(request: Request):
    raw_body = await request.body()
    event = await waslpay.handle_webhook(raw_body, dict(request.headers))
    return {"event_id": event.id}
`;
  }

  // Django
  return `# Generated for ${framework}. Selected providers: ${providers.join(", ")}
import os
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from waslpay import WaslPay, PaymentRequest
${importStmt}

${code}
waslpay = WaslPay(provider)

@csrf_exempt
async def create_checkout(request):
    session = await waslpay.initiate_payment(PaymentRequest(
        amount=1000,
        currency="XOF",
        reference="order-123",
        customer_phone="+221770000000",
    ))
    return JsonResponse({"session_id": session.id, "payment_url": session.payment_url})

@csrf_exempt
async def webhook(request):
    raw_body = request.body
    event = await waslpay.handle_webhook(raw_body, dict(request.headers.items()))
    return JsonResponse({"event_id": event.id})
`;
}
