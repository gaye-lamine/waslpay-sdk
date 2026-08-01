import React, { useState } from "react";

type Provider = "wave" | "orange-money" | "mtn-momo";
type Action = "checkout" | "checkStatus" | "triggerWebhook" | "refund";
type Mode = "backend" | "mock";

export default function ApiPlayground(): React.JSX.Element {
  const [devPort, setDevPort] = useState(4004);
  const [mode, setMode] = useState<Mode>("backend");
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

  const devBase = `http://localhost:${devPort}`;

  // Build request URL from mode + action + provider
  function buildRequest(): { url: string; method: string; body: string | undefined } {
    let method = "POST";
    let url = devBase;
    let body: string | undefined = undefined;
    const sid = sessionId || "session_demo";

    if (mode === "backend") {
      // All backend calls go through the proxy
      if (action === "checkout") {
        url += `/proxy/checkout/${provider}`;
        body = JSON.stringify({ amount, reference, customer_phone: customerPhone });
      } else if (action === "checkStatus") {
        method = "GET";
        url += `/proxy/checkout/${provider}/${sid}`;
      } else if (action === "triggerWebhook") {
        url += `/proxy/api/webhooks/waslpay/${provider}`;
        body = buildWebhookBody();
      } else {
        url += `/proxy/refund/${provider}/${sid}`;
        body = JSON.stringify({ amount });
      }
    } else {
      // Mock routes directly on waslpay dev
      if (action === "checkout") {
        if (provider === "wave") { url += "/mock/wave/checkout/sessions"; body = JSON.stringify({ client_reference: reference, amount }); }
        else if (provider === "orange-money") { url += "/mock/orange/v1/onlinePayment/prepare"; body = JSON.stringify({ reference, amount }); }
        else { url += "/mock/mtn/collection/v1_0/requesttopay"; body = JSON.stringify({ externalId: reference, amount: String(amount) }); }
      } else if (action === "checkStatus") {
        method = "GET";
        if (provider === "wave") url += `/mock/wave/checkout/sessions/${sid}`;
        else if (provider === "orange-money") url += `/mock/orange/api/eWallet/v1/transactions?reference=${reference}`;
        else url += `/mock/mtn/collection/v1_0/requesttopay/${sid}`;
      } else if (action === "triggerWebhook") {
        // Webhook is always against the backend via waslpay dev standard route
        url += `/proxy/api/webhooks/waslpay/${provider}`;
        body = buildWebhookBody();
      } else {
        if (provider === "wave") { url += `/mock/wave/checkout/sessions/${sid}/refund`; body = JSON.stringify({ amount }); }
        else if (provider === "orange-money") { url += `/mock/orange/v1/refund`; body = JSON.stringify({ reference, amount }); }
        else { url += `/mock/mtn/collection/v1_0/refund`; body = JSON.stringify({ externalId: reference, amount: String(amount) }); }
      }
    }

    return { url, method, body };
  }

  function buildWebhookBody(): string {
    if (provider === "wave") {
      return JSON.stringify({
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
    }
    if (provider === "orange-money") {
      return JSON.stringify({
        id: `evt_${Date.now()}`, transactionId: sessionId || `tx_${Date.now()}`,
        reference, status: webhookOutcome === "success" ? "SUCCESS" : "FAILED",
        timestamp: new Date().toISOString(),
      });
    }
    return JSON.stringify({
      id: `evt_${Date.now()}`, referenceId: sessionId || `ref_${Date.now()}`,
      externalId: reference, status: webhookOutcome === "success" ? "SUCCESSFUL" : "FAILED",
      timestamp: new Date().toISOString(),
    });
  }

  const { url: fullUrl, method, body: previewBody } = buildRequest();

  const handleExecute = async () => {
    setLoading(true);
    setResponseStatus(null);
    setResponseBody(null);
    setError(null);
    setElapsedTime(null);

    const start = performance.now();
    try {
      const { url, method: m, body } = buildRequest();
      const res = await fetch(url, {
        method: m,
        headers: { "Content-Type": "application/json" },
        body,
      });
      const elapsed = Math.round(performance.now() - start);
      setElapsedTime(elapsed);
      setResponseStatus(`${res.status} ${res.statusText}`);

      // 502 from proxy means backend is down
      if (res.status === 502) {
        const data = await res.json().catch(() => ({}));
        const target: string = (data as any)?.target ?? "";
        setError(
          `Le serveur mock WaslPay ne peut pas joindre votre backend.\n\n` +
          `URL tentée : ${target}\n\n` +
          `Démarrez votre backend avec :\n` +
          `  uvicorn waslpay-integration:app --port 8000   (Python)\n` +
          `  node index.js                                  (Node.js)`
        );
        return;
      }

      const text = await res.text();
      try {
        setResponseBody(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResponseBody(text);
      }
    } catch (err: any) {
      const raw: string = err?.message ?? "";
      if (raw.includes("Failed to fetch") || raw.includes("fetch failed") || raw.includes("NetworkError")) {
        setError(
          `Impossible de joindre le serveur mock WaslPay sur ${devBase}.\n\n` +
          `Démarrez-le dans un terminal avec :\n` +
          `  npx @waslpay/cli dev --target http://localhost:8000/api/webhooks/waslpay\n\n` +
          `Le serveur mock doit être actif sur le port ${devPort} pour que le Playground puisse l'atteindre.\n\n` +
          `Note : http://localhost est autorisé depuis une page HTTPS (exception navigateur pour le développement local).`
        );
      } else {
        setError(raw || "Erreur réseau inattendue.");
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.45rem 0.6rem", borderRadius: "4px",
    border: "1px solid var(--ifm-color-emphasis-400)", fontSize: "0.85rem",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = { display: "block", fontWeight: "600", fontSize: "0.8rem", marginBottom: "0.25rem" };

  return (
    <div style={{ border: "1px solid var(--ifm-color-emphasis-300)", borderRadius: "8px", padding: "1.25rem", marginBottom: "2rem", background: "var(--ifm-card-background-color)" }}>
      <h3 style={{ marginTop: 0, color: "var(--ifm-color-primary)", fontSize: "1.1rem" }}>Playground WaslPay SDK</h3>

      {/* Prerequisite notice */}
      <div style={{ background: "var(--ifm-color-emphasis-100)", borderLeft: "3px solid var(--ifm-color-primary)", padding: "0.6rem 0.8rem", borderRadius: "0 4px 4px 0", marginBottom: "1.25rem", fontSize: "0.82rem" }}>
        <strong>Prérequis :</strong> Démarrez le serveur mock WaslPay dans votre terminal :{" "}
        <code style={{ fontSize: "0.8rem" }}>npx @waslpay/cli dev --target http://localhost:8000/api/webhooks/waslpay</code>
        <br />
        Toutes les requêtes du Playground transitent par <code>localhost:{devPort}</code> — le mock ajoute les entêtes CORS et proxifie vers votre backend.
      </div>

      {/* Dev port + mode row */}
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
        <div>
          <label style={labelStyle}>Port waslpay dev</label>
          <input type="number" value={devPort} onChange={(e) => setDevPort(Number(e.target.value))} style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>Fournisseur</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} style={inputStyle}>
            <option value="wave">Wave Sénégal</option>
            <option value="orange-money">Orange Money Sénégal</option>
            <option value="mtn-momo">MTN MoMo</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>Action</label>
          <select value={action} onChange={(e) => setAction(e.target.value as Action)} style={inputStyle}>
            <option value="checkout">Initiate Payment</option>
            <option value="checkStatus">Check Status</option>
            <option value="triggerWebhook">Simuler Webhook</option>
            <option value="refund">Remboursement</option>
          </select>
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        {(["backend", "mock"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: "0.3rem 0.75rem", borderRadius: "4px", fontSize: "0.82rem", fontWeight: "600", cursor: "pointer",
              border: "1px solid var(--ifm-color-emphasis-400)",
              background: mode === m ? "var(--ifm-color-primary)" : "transparent",
              color: mode === m ? "#fff" : "inherit",
            }}
          >
            {m === "backend" ? "Backend applicatif (via proxy)" : "Mock WaslPay direct"}
          </button>
        ))}
      </div>

      {/* Dynamic fields */}
      <div style={{ background: "var(--ifm-color-emphasis-100)", padding: "0.8rem 1rem", borderRadius: "6px", marginBottom: "1.25rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
          {(action === "checkout" || action === "refund") && (
            <div>
              <label style={labelStyle}>Montant (XOF)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={inputStyle} />
            </div>
          )}
          {(action === "checkout" || action === "triggerWebhook" || (action === "checkStatus" && provider === "orange-money")) && (
            <div>
              <label style={labelStyle}>Référence commande</label>
              <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} style={inputStyle} />
            </div>
          )}
          {action === "checkout" && (
            <div>
              <label style={labelStyle}>Téléphone client</label>
              <input type="text" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} style={inputStyle} />
            </div>
          )}
          {(action === "checkStatus" || action === "refund" || action === "triggerWebhook") && provider !== "orange-money" && (
            <div>
              <label style={labelStyle}>ID de session / transaction</label>
              <input type="text" placeholder={`ex: ${provider === "wave" ? "wave_0cbdb603..." : "ref_abc123..."}`} value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={inputStyle} />
            </div>
          )}
          {action === "triggerWebhook" && (
            <div>
              <label style={labelStyle}>Résultat simulé</label>
              <select value={webhookOutcome} onChange={(e) => setWebhookOutcome(e.target.value as "success" | "failed")} style={inputStyle}>
                <option value="success">Paiement réussi</option>
                <option value="failed">Paiement échoué</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Request preview */}
      <div style={{ background: "var(--ifm-pre-background)", padding: "0.5rem 0.8rem", borderRadius: "4px", marginBottom: "1rem", fontFamily: "monospace", fontSize: "0.82rem", wordBreak: "break-all" }}>
        <span style={{ color: method === "GET" ? "#2e7d32" : "#1565c0", fontWeight: "bold", marginRight: "0.5rem" }}>{method}</span>
        <span>{fullUrl}</span>
      </div>

      <button
        onClick={handleExecute}
        disabled={loading}
        style={{
          background: "var(--ifm-color-primary)", color: "#fff", border: "none",
          padding: "0.5rem 1.25rem", borderRadius: "4px", fontWeight: "600",
          cursor: loading ? "wait" : "pointer", fontSize: "0.85rem",
        }}
      >
        {loading ? "Traitement en cours..." : "Exécuter la requête"}
      </button>

      {(responseStatus || error || responseBody) && (
        <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--ifm-color-emphasis-300)", paddingTop: "0.8rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
            <span style={{ fontWeight: "600", fontSize: "0.85rem" }}>Résultat</span>
            {responseStatus && !error && (
              <span style={{ padding: "0.15rem 0.5rem", borderRadius: "3px", background: responseStatus.startsWith("2") ? "#2e7d32" : "#c62828", color: "#fff", fontWeight: "600", fontSize: "0.8rem" }}>
                {responseStatus} {elapsedTime !== null && `(${elapsedTime} ms)`}
              </span>
            )}
          </div>

          {error && (
            <div style={{ background: "var(--ifm-color-danger-contrast-background)", color: "var(--ifm-color-danger)", padding: "0.75rem 1rem", borderRadius: "4px", fontSize: "0.82rem", lineHeight: "1.6" }}>
              <strong style={{ display: "block", marginBottom: "0.3rem" }}>Diagnostic</strong>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", background: "transparent", fontFamily: "inherit", color: "inherit", fontSize: "0.82rem" }}>{error}</pre>
            </div>
          )}

          {responseBody && !error && (
            <pre style={{ background: "var(--ifm-pre-background)", padding: "0.8rem", borderRadius: "4px", overflowX: "auto", fontSize: "0.8rem", margin: 0 }}>
              <code>{responseBody}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
