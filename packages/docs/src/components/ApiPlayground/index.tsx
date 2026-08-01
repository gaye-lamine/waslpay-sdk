import React, { useState } from "react";

type Provider = "wave" | "orange-money" | "mtn-momo";
type Action = "checkout" | "checkStatus" | "triggerWebhook" | "refund";

export default function ApiPlayground(): React.JSX.Element {
  const [targetUrl, setTargetUrl] = useState("http://localhost:8000");
  const [provider, setProvider] = useState<Provider>("wave");
  const [action, setAction] = useState<Action>("checkout");

  // Form inputs
  const [amount, setAmount] = useState(1000);
  const [reference, setReference] = useState("order-123");
  const [customerPhone, setCustomerPhone] = useState("+221770000000");
  const [sessionId, setSessionId] = useState("");
  const [webhookOutcome, setWebhookOutcome] = useState<"success" | "failed">("success");

  // State response
  const [loading, setLoading] = useState(false);
  const [responseStatus, setResponseStatus] = useState<string | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({});
  const [responseBody, setResponseBody] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExecute = async () => {
    setLoading(true);
    setResponseStatus(null);
    setResponseBody(null);
    setError(null);
    setElapsedTime(null);

    const start = performance.now();
    try {
      let url = targetUrl.replace(/\/+$/g, "");
      let method = "POST";
      let headers: Record<string, string> = { "Content-Type": "application/json" };
      let body: string | undefined = undefined;

      if (action === "checkout") {
        url += `/checkout/${provider}`;
        body = JSON.stringify({ amount, reference, customer_phone: customerPhone });
      } else if (action === "checkStatus") {
        url += `/mock/${provider === "orange-money" ? "orange" : provider === "mtn-momo" ? "mtn" : "wave"}/checkout/${sessionId || "demo-session"}`;
        method = "GET";
      } else if (action === "triggerWebhook") {
        url += `/api/webhooks/waslpay/${provider}`;
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
      } else if (action === "refund") {
        url += `/refund/${provider}/${sessionId || "demo-session"}`;
        body = JSON.stringify({ amount });
      }

      const res = await fetch(url, { method, headers, body });
      const elapsed = Math.round(performance.now() - start);
      setElapsedTime(elapsed);
      setResponseStatus(`${res.status} ${res.statusText}`);

      const resHeaders: Record<string, string> = {};
      res.headers.forEach((val, key) => { resHeaders[key] = val; });
      setResponseHeaders(resHeaders);

      const text = await res.text();
      try {
        const json = JSON.parse(text);
        setResponseBody(JSON.stringify(json, null, 2));
      } catch {
        setResponseBody(text);
      }
    } catch (err: any) {
      setError(err.message || "Erreur de connexion HTTP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ border: "1px solid var(--ifm-color-emphasis-300)", borderRadius: "8px", padding: "1.25rem", marginBottom: "2rem", background: "var(--ifm-card-background-color)" }}>
      <h3 style={{ marginTop: 0, color: "var(--ifm-color-primary)", fontSize: "1.2rem" }}>Playground WaslPay SDK</h3>
      <p style={{ fontSize: "0.9rem", opacity: 0.9, marginBottom: "1.25rem" }}>
        Exécution directe de requêtes HTTP sur votre serveur backend local ou sur le mock WaslPay.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        <div>
          <label style={{ display: "block", fontWeight: "600", fontSize: "0.85rem", marginBottom: "0.3rem" }}>URL Cible</label>
          <input
            type="text"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            style={{ width: "100%", padding: "0.45rem 0.6rem", borderRadius: "4px", border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.9rem" }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontWeight: "600", fontSize: "0.85rem", marginBottom: "0.3rem" }}>Fournisseur</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            style={{ width: "100%", padding: "0.45rem 0.6rem", borderRadius: "4px", border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.9rem" }}
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
            style={{ width: "100%", padding: "0.45rem 0.6rem", borderRadius: "4px", border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.9rem" }}
          >
            <option value="checkout">Initiate Payment (POST /checkout)</option>
            <option value="checkStatus">Check Status (GET /mock/status)</option>
            <option value="triggerWebhook">Simuler Webhook (POST /webhooks)</option>
            <option value="refund">Demander un Remboursement (POST /refund)</option>
          </select>
        </div>
      </div>

      <div style={{ background: "var(--ifm-color-emphasis-100)", padding: "1rem", borderRadius: "6px", marginBottom: "1.25rem" }}>
        <h4 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>Paramètres de la requête</h4>
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
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "600" }}>Référence</label>
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
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "600" }}>ID de session</label>
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
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "600" }}>Résultat</label>
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
          fontSize: "0.9rem",
        }}
      >
        {loading ? "Traitement en cours..." : "Exécuter la requête"}
      </button>

      {(responseStatus || error || responseBody) && (
        <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--ifm-color-emphasis-300)", paddingTop: "0.8rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
            <span style={{ fontWeight: "600", fontSize: "0.9rem" }}>Réponse</span>
            {responseStatus && (
              <span style={{ padding: "0.15rem 0.5rem", borderRadius: "3px", background: responseStatus.startsWith("2") ? "#2e7d32" : "#c62828", color: "#fff", fontWeight: "600", fontSize: "0.8rem" }}>
                {responseStatus} {elapsedTime !== null && `(${elapsedTime} ms)`}
              </span>
            )}
          </div>

          {error && (
            <div style={{ background: "var(--ifm-color-danger-contrast-background)", color: "var(--ifm-color-danger)", padding: "0.6rem 0.8rem", borderRadius: "4px", fontSize: "0.85rem" }}>
              <strong>Erreur :</strong> {error}
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
