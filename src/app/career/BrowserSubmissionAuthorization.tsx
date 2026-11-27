"use client";

import { useState } from "react";

type Props = { kitId: string; destinationUrl: string; onDone: () => Promise<void>; renewal?: boolean };

/** Hands off a one-time capability to the installed Chrome extension via the
 * dashboard content script. The token is never persisted in the dashboard. */
export function BrowserSubmissionAuthorization({ kitId, destinationUrl, onDone, renewal = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function authorize() {
    if (!window.confirm("Autorizar este pacote exato para preenchimento e envio no portal oficial? A extensão pausará se encontrar CAPTCHA, MFA, pergunta nova ou alteração material.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/career/application-kits/${kitId}/browser-authorization`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ renew: renewal }) });
      const payload = await response.json() as { error?: string; activationToken?: string | null; submission?: { id: string; state: string } };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível autorizar a extensão.");
      if (payload.activationToken && payload.submission) {
        const submissionId = payload.submission.id;
        const activationToken = payload.activationToken;
        const handoff = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
          let timeout = 0;
          function finish(result: { ok: boolean; error?: string }) { window.clearTimeout(timeout); window.removeEventListener("message", onMessage); resolve(result); }
          function onMessage(event: MessageEvent) {
            if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== "PIPELINEPOST_BROWSER_APPLICATION_HANDOFF_RESULT") return;
            finish(event.data.payload ?? { ok: false, error: "Resposta inválida da extensão." });
          }
          window.addEventListener("message", onMessage);
          window.postMessage({ type: "PIPELINEPOST_BROWSER_APPLICATION_AUTHORIZED", payload: { apiBase: window.location.origin, token: activationToken, submissionId, destinationUrl } }, window.location.origin);
          timeout = window.setTimeout(() => finish({ ok: false, error: "A extensão não respondeu. Recarregue a página do painel e a extensão em chrome://extensions." }), 2500);
        });
        if (!handoff.ok) throw new Error(handoff.error ?? "A extensão não confirmou o recebimento.");
        setMessage(renewal ? "Credencial renovada para o mesmo pacote aprovado. A extensão Chrome reabrirá o portal e continuará o acompanhamento." : "Autorização registrada. A extensão Chrome abrirá o portal e reportará cada etapa aqui. Se ela não abrir, confirme que está instalada e ativa.");
      } else setMessage("Já existe uma autorização para esta versão. Atualize a fila para acompanhar o estado.");
      await onDone();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao autorizar a extensão."); }
    finally { setBusy(false); }
  }
  return <div className="application-kit-review">
    <p className="admin-meta">A extensão Chrome recebe apenas este pacote aprovado, preenche o portal oficial e registra preenchimento, bloqueios e confirmação. Ela não tenta superar CAPTCHA ou MFA.</p>
    <button className="admin-button active" type="button" disabled={busy} onClick={() => void authorize()}>{busy ? "Autorizando…" : renewal ? "Reabrir no Chrome" : "Aprovar e autorizar preenchimento no Chrome"}</button>
    {message && <p className="admin-meta" role="status">{message}</p>}
    {error && <p className="admin-error" role="alert">{error}</p>}
  </div>;
}
