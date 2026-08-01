import React, { useState } from "react";

type Provider = "wave" | "orange-money" | "mtn-momo";
type Action = "checkout" | "checkStatus" | "triggerWebhook" | "refund";
type Mode = "backend" | "mock";

export default function ApiPlayground(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>("backend");
  const [targetUrl, setTargetUrl] = useState("http://localhost:8000");
  const [mockUrl, setMockUrl] = useState("http://localhost:4004");
  const [provider, setProvider] = useState<Provider>("wave");
  const [action, setAction] = useState<Action>("checkout");

  // Form inputs
  const [amount, setAmount] = useState(1000);
  const [reference, setReference] = useState("order-123");
  const [customerPhone, setCustomerPhone] = useState("+221770000000");
  const [sessionId, setSessionId] = useState("");
  const [webhookOutcome, setWebhookOutcome] = useState<"success" | "failed">("success");

  // Response state
  const [loading, setLoading] = useState(false);
  const [responseStatus, setResponseStatus] = useState<string | null>(null);
  const [responseBody, setResponseBody] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Compute endpoint & method dynamically
  const baseUrl = (mode === "mock" ? mockUrl : targetUrl).replace(/\/+$/g, "");
  const providerShort = provider === "orange-money" ? "orange" : provider === "mtn-momo" ? "mtn" : "wave";

  let method = "POST";
  let endpointPath = "";
  if (action === "checkout") {
    endpointPath = mode === "mock"
      ? (provider === "wave" ? "/mock/wave/checkout/sessions" : provider === "orange-money" ? "/mock/orange/v1/onlinePayment/prepare" : "/mock/mtn/collection/v1_0/requesttopay")
      : `/checkout/${provider}`;
  } else if (action === "checkStatus") {
    method = "GET";
    const sid = sessionId || "session_demo_123";
    endpointPath = mode === "mock"
      ? (provider === "wave" ? `/mock/wave/checkout/sessions/${sid}` : provider === "orange-money" ? `/mock/orange/api/eWallet/v1/transactions?reference=${reference}` : `/mock/mtn/collection/v1_0/requesttopay/${sid}`)
      : `/checkout/${provider}/${sid}`;
  } else if (action === "triggerWebhook") {
    endpointPath = `/api/webhooks/waslpay/${provider}`;
  } else if (action === "refund") {
    const sid = sessionId || "session_demo_123";
    endpointPath = mode === "mock"
      ? (provider === "wave" ? `/mock/wave/checkout/sessions/${sid}/refund` : provider === "orange-money" ? `/mock/orange/v1/refund` : `/mock/mtn/collection/v1_0/refund`)
      : `/refund/${provider}/${sid}`;
  }

  const fullUrl = `${baseUrl}${endpointPath}`;

  const handleExecute = async () => {
    setLoading(true);
    setResponseStatus(null);
    setResponseBody(null);
    setError(null);
    setElapsedTime(null);

    const start = performance.now();
    try {
      let headers: Record<string, string> = { "Content-Type": "application/json" };
      let body: string | undefined = undefined;

      if (method === "POST") {
        if (action === "checkout") {
          body = JSON.stringify({ amount, reference, customer_phone: customerPhone });
        } else if (action === "refund") {
          body = JSON.stringify({ amount });
        } else if (action === "triggerWebhook") {
          if (provider === "wave") {
            body = JSON.stringify({
              id: `evt_${Date.now()}`,
              type: webhookOutcome === "success" ? "checkout.session.completed" : "checkout.session.failed",
              data: {
                id: sessionId || `session_${Date.now()}`,
                client_reference: reference,
                payment_status: webhookOutcome === "success" ? "succeeded" : "cancelled",
                checkout_status: "complete",
              },
              occurredAt: new Date().toISOString(),
            });
          } else if (provider === "orange-money") {
            body = JSON.stringify({
              id: `evt_${Date.now()}`,
              transactionId: sessionId || `tx_${Date.now()}`,
              reference,
              status: webhookOutcome === "success" ? "SUCCESS" : "FAILED",
              timestamp: new Date().toISOString(),
            });
          } else {
            body = JSON.stringify({
              id: `evt_${Date.now()}`,
              referenceId: sessionId || `ref_${Date.now()}`,
              externalId: reference,
              status: webhookOutcome === "success" ? "SUCCESSFUL" : "FAILED",
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      const res = await fetch(fullUrl, { method, headers, body });
      const elapsed = Math.round(performance.now() - start);
      setElapsedTime(elapsed);
      setResponseStatus(`${res.status} ${res.statusText}`);

      const text = await res.text();
      try {
        const json = JSON.parse(text);
        setResponseBody(JSON.stringify(json, null, 2));
      } catch {
        setResponseBody(text);
      }
    } catch (err: any) {
      const raw: string = err?.message ?? "";
      let diagnostic: string;
      if (raw.includes("Failed to fetch") || raw.includes("fetch failed") || raw.includes("NetworkError") || raw.includes("ERR_CONNECTION_REFUSED")) {
        const serverLabel = mode === "mock"
          ? `le serveur mock WaslPay CLI (${mockUrl})`
          : `votre serveur backend (${targetUrl})`;
        const startCmd = mode === "mock"
          ? "`npx @waslpay/cli dev --target <url-webhook>`"
          : "`uvicorn waslpay-integration:app --port 8000` (Python) ou `node index.js` (Node.js)";
        diagnostic = `Le serveur cible est inaccessible. Vérifiez que ${serverLabel} est démarré.\n\nCommande de démarrage : ${startCmd}\n\nSi le serveur est démarré mais l\'erreur persiste, vérifiez que le middleware CORS est activé sur votre backend (Access-Control-Allow-Origin manquant).`;
      } else if (raw.includes("CORS") || raw.includes("cross-origin") || raw.includes("Access-Control") || raw.includes("blocked")) {
        diagnostic = `Requête bloquée par la politique CORS du navigateur.\n\nVotre serveur backend doit retourner l\'en-tête :\n  Access-Control-Allow-Origin: *\n\nPour FastAPI : ajoutez CORSMiddleware.\nPour Express : utilisez le middleware cors().`;
      } else if (raw.includes("ERR_NAME_NOT_RESOLVED") || raw.includes("getaddrinfo") || raw.includes("DNS")) {
        diagnostic = `URL invalide ou inaccessible : "${fullUrl}".\n\nVérifiez l\'URL cible saisie. En développement local, utilisez http://localhost:<port>.`;
      } else if (raw.includes("timeout") || raw.includes("ETIMEDOUT") || raw.includes("AbortError")) {
        diagnostic = `La requête a dépassé le délai d\'attente (timeout).\n\nVotre serveur a peut-être planté ou est surchargé. Vérifiez les logs de votre backend.`;
      } else {
        diagnostic = raw || "Erreur réseau inattendue.";
      }
      setError(diagnostic);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ border: "1px solid var(--ifm-color-emphasis-300)", borderRadius: "8px", padding: "1.25rem", marginBottom: "2rem", background: "var(--ifm-card-background-color)" }}>
      <h3 style={{ marginTop: 0, color: "var(--ifm-color-primary)", fontSize: "1.15rem" }}>Playground WaslPay SDK</h3>

      {/* Mode Selector */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <button
          onClick={() => setMode("backend")}
          style={{
            padding: "0.4rem 0.8rem",
            borderRadius: "4px",
            border: "1px solid var(--ifm-color-emphasis-400)",
            background: mode === "backend" ? "var(--ifm-color-primary)" : "transparent",
            color: mode === "backend" ? "#fff" : "inherit",
            cursor: "pointer",
            fontSize: "0.85rem",
            fontWeight: "600",
          }}
        >
          Serveur Backend Applicatif (ex: FastAPI/Express)
        </button>
        <button
          onClick={() => setMode("mock")}
          style={{
            padding: "0.4rem 0.8rem",
            borderRadius: "4px",
            border: "1px solid var(--ifm-color-emphasis-400)",
            background: mode === "mock" ? "var(--ifm-color-primary)" : "transparent",
            color: mode === "mock" ? "#fff" : "inherit",
            cursor: "pointer",
            fontSize: "0.85rem",
            fontWeight: "600",
          }}
        >
          Serveur Mock WaslPay CLI (port 4004)
        </button>
      </div>

      {/* Top Configuration */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        <div>
          <label style={{ display: "block", fontWeight: "600", fontSize: "0.85rem", marginBottom: "0.3rem" }}>
            {mode === "backend" ? "URL Backend Applicatif" : "URL Serveur Mock WaslPay"}
          </label>
          <input
            type="text"
            value={mode === "backend" ? targetUrl : mockUrl}
            onChange={(e) => mode === "backend" ? setTargetUrl(e.target.value) : setMockUrl(e.target.value)}
            style={{ width: "100%", padding: "0.45rem 0.6rem", borderRadius: "4px", border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.85rem" }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontWeight: "600", fontSize: "0.85rem", marginBottom: "0.3rem" }}>Fournisseur</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            style={{ width: "100%", padding: "0.45rem 0.6rem", borderRadius: "4px", border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.85rem" }}
          >
            <option value="wave">Wave Sénégal</option>
            <option value="orange-money">Orange Money Sénégal</option>
            <option value="mtn-momo">MTN MoMo</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontWeight: "600", fontSize: "0.85rem", marginBottom: "0.3rem" }}>Action</label>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as Action)}
            style={{ width: "100%", padding: "0.45rem 0.6rem", borderRadius: "4px", border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.85rem" }}
          >
            <option value="checkout">Initiate Payment (POST /checkout)</option>
            <option value="checkStatus">Check Status (GET /status)</option>
            <option value="triggerWebhook">Simuler Webhook (POST /webhooks)</option>
            <option value="refund">Demander un Remboursement (POST /refund)</option>
          </select>
        </div>
      </div>

      {/* Target HTTP Request Preview */}
      <div style={{ background: "var(--ifm-pre-background)", padding: "0.6rem 0.8rem", borderRadius: "4px", marginBottom: "1.25rem", fontFamily: "monospace", fontSize: "0.85rem" }}>
        <span style={{ color: method === "GET" ? "#2e7d32" : "#1976d2", fontWeight: "bold", marginRight: "0.5rem" }}>{method}</span>
        <span>{fullUrl}</span>
      </div>

      {/* Dynamic Fields adapt strictly to current Action */}
      <div style={{ background: "var(--ifm-color-emphasis-100)", padding: "1rem", borderRadius: "6px", marginBottom: "1.25rem" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.9rem" }}>
          Paramètres requis pour {action === "checkout" ? "l'initialisation" : action === "checkStatus" ? "le contrôle de statut" : action === "triggerWebhook" ? "le webhook" : "le remboursement"}
        </h4>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.8rem" }}>
          {(action === "checkout" || action === "refund") && (
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "600" }}>Montant (XOF)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "4px", border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.85rem" }}
              />
            </div>
          )}

          {(action === "checkout" || action === "triggerWebhook") && (
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "600" }}>Référence commande</label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "4px", border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.85rem" }}
              />
            </div>
          )}

          {action === "checkout" && (
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "600" }}>Téléphone client</label>
              <input
                type="text"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "4px", border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.85rem" }}
              />
            </div>
          )}

          {(action === "checkStatus" || action === "refund" || action === "triggerWebhook") && (
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "600" }}>ID de session / transaction</label>
              <input
                type="text"
                placeholder="ex: wave_0cbdb603..."
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "4px", border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.85rem" }}
              />
            </div>
          )}

          {action === "triggerWebhook" && (
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "600" }}>Résultat simulant le paiement</label>
              <select
                value={webhookOutcome}
                onChange={(e) => setWebhookOutcome(e.target.value as "success" | "failed")}
                style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "4px", border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.85rem" }}
              >
                <option value="success">Success (.completed / SUCCESSFUL)</option>
                <option value="failed">Failed (.failed / FAILED)</option>
              </select>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={handleExecute}
        disabled={loading}
        style={{
          background: "var(--ifm-color-primary)",
          color: "#fff",
          border: "none",
          padding: "0.5rem 1.25rem",
          borderRadius: "4px",
          fontWeight: "600",
          cursor: loading ? "wait" : "pointer",
          fontSize: "0.85rem",
        }}
      >
        {loading ? "Traitement en cours..." : "Exécuter la requête"}
      </button>

      {(responseStatus || error || responseBody) && (
        <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--ifm-color-emphasis-300)", paddingTop: "0.8rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
            <span style={{ fontWeight: "600", fontSize: "0.85rem" }}>Résultat</span>
            {responseStatus && (
              <span style={{ padding: "0.15rem 0.5rem", borderRadius: "3px", background: responseStatus.startsWith("2") ? "#2e7d32" : "#c62828", color: "#fff", fontWeight: "600", fontSize: "0.8rem" }}>
                {responseStatus} {elapsedTime !== null && `(${elapsedTime} ms)`}
              </span>
            )}
          </div>

          {error && (
            <div style={{ background: "var(--ifm-color-danger-contrast-background)", color: "var(--ifm-color-danger)", padding: "0.75rem 1rem", borderRadius: "4px", fontSize: "0.85rem", lineHeight: "1.6" }}>
              <strong style={{ display: "block", marginBottom: "0.4rem" }}>Diagnostic d\'erreur</strong>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", background: "transparent", fontSize: "0.82rem", fontFamily: "inherit", color: "inherit" }}>{error}</pre>
            </div>
          )}

          {responseBody && (
            <pre style={{ background: "var(--ifm-pre-background)", padding: "0.8rem", borderRadius: "4px", overflowX: "auto", fontSize: "0.8rem", margin: 0 }}>
              <code>{responseBody}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
