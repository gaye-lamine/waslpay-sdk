export type Provider = "orange-money" | "wave" | "mtn-momo";

const PROVIDER_ENV: Record<Provider, readonly string[]> = {
  "orange-money": [
    "# Orange Money Sénégal (Sonatel)",
    "ORANGE_MONEY_CLIENT_ID=",
    "ORANGE_MONEY_CLIENT_SECRET=",
    "ORANGE_MONEY_MERCHANT_CODE=",
    "ORANGE_MONEY_SITENAME=",
    "ORANGE_MONEY_CALLBACK_URL=",
    "ORANGE_MONEY_WEBHOOK_API_KEY=",
    "ORANGE_MONEY_ENVIRONMENT=sandbox",
  ],
  wave: [
    "# Wave Sénégal Checkout",
    "WAVE_API_KEY=",
    "WAVE_WEBHOOK_SECRET=",
  ],
  "mtn-momo": [
    "# MTN MoMo Collection",
    "MTN_MOMO_SUBSCRIPTION_KEY=",
    "MTN_MOMO_API_USER=",
    "MTN_MOMO_API_KEY=",
    "MTN_MOMO_TARGET_ENVIRONMENT=sandbox",
    "MTN_MOMO_DEFAULT_CURRENCY=XOF",
  ],
};

const MOCK_VALUES: Record<Provider, readonly string[]> = {
  // ORANGE_MONEY_WEBHOOK_API_KEY must match DEV_MOCK_SECRETS.orange in dev.ts
  "orange-money": ["ORANGE_MONEY_CLIENT_ID=mock_orange_client", "ORANGE_MONEY_CLIENT_SECRET=mock_orange_secret", "ORANGE_MONEY_MERCHANT_CODE=mock_merchant", "ORANGE_MONEY_SITENAME=waslpay-dev", "ORANGE_MONEY_CALLBACK_URL=http://localhost:8000/api/webhooks/waslpay", "ORANGE_MONEY_WEBHOOK_API_KEY=mock_orange_api_key", "ORANGE_MONEY_ENVIRONMENT=sandbox", "ORANGE_MONEY_BASE_URL=http://localhost:4004/mock/orange"],
  // WAVE_WEBHOOK_SECRET must match DEV_MOCK_SECRETS.wave in dev.ts
  wave: ["WAVE_API_KEY=mock_wave_key", "WAVE_WEBHOOK_SECRET=mock_wave_webhook_secret", "WAVE_BASE_URL=http://localhost:4004/mock/wave"],
  // MTN_MOMO_SUBSCRIPTION_KEY is also used as the webhook auth header -- must match DEV_MOCK_SECRETS.mtn in dev.ts
  "mtn-momo": ["MTN_MOMO_SUBSCRIPTION_KEY=mock_mtn_subscription", "MTN_MOMO_API_USER=00000000-0000-4000-8000-000000000001", "MTN_MOMO_API_KEY=mock_mtn_key", "MTN_MOMO_TARGET_ENVIRONMENT=sandbox", "MTN_MOMO_DEFAULT_CURRENCY=XOF", "MTN_MOMO_BASE_URL=http://localhost:4004/mock/mtn"],
};

export function generateEnvExample(providers: readonly Provider[], mock = false): string {
  if (mock) {
    const sections = providers.flatMap((provider) => [...MOCK_VALUES[provider], ""]);
    return ["# Mode test sans clés (--mock). Lancez `waslpay dev` pour démarrer le serveur mock.", "# Pour passer en production, remplacez UNIQUEMENT ces valeurs par vos vraies clés et supprimez les lignes *_BASE_URL -- aucune modification de code n'est nécessaire.", "", ...sections].join("\n");
  }
  const sections = providers.flatMap((provider) => [...PROVIDER_ENV[provider], ""]);
  return ["# WaslPay SDK configuration", "# Never commit actual secrets.", "", ...sections].join("\n");
}
