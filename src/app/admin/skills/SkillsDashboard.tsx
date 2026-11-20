"use client";

import { useState } from "react";

type Result = Record<string, unknown> | null;

async function callSkill(body: Record<string, unknown>): Promise<Result> {
  const response = await fetch("/api/linkedin/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Falha ao executar a skill.");
  return payload;
}

export function SkillsDashboard() {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: string) {
    setBusy(true); setError("");
    try { setResult(await callSkill({ action, title, textContent: text, postText: text, thread: text, replyTarget: title, editorialPillar: "TOFU", slides: [] })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha inesperada."); }
    finally { setBusy(false); }
  }

  return <main className="admin-shell"><div className="admin-container">
    <header className="admin-header"><div><div className="admin-kicker">LinkedIn Skills Engine</div><h1 className="admin-title">Revisão, voz e planejamento</h1><p className="admin-subtitle">Use as skills antes da aprovação. Nada é publicado automaticamente por esta tela.</p></div></header>
    <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Ferramentas</div><h2>Escolha uma análise</h2></div></div>
      <input className="admin-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título ou comentário-alvo" />
      <textarea className="admin-textarea" value={text} onChange={(event) => setText(event.target.value)} placeholder="Cole aqui o post, comentário ou thread para analisar" />
      <div className="admin-actions">
        <button className="admin-button active" disabled={busy || !text.trim()} onClick={() => void run("audit")}>Pós-auditoria</button>
        <button className="admin-button" disabled={busy || !text.trim()} onClick={() => void run("humanize")}>Humanizar</button>
        <button className="admin-button" disabled={busy || !text.trim()} onClick={() => void run("hook")}>Extrair gancho</button>
        <button className="admin-button" disabled={busy || !text.trim()} onClick={() => void run("comment")}>Rascunhar comentário</button>
        <button className="admin-button" disabled={busy || !text.trim()} onClick={() => void run("reply")}>Rascunhar resposta</button>
        <button className="admin-button" disabled={busy} onClick={() => void run("profile")}>Otimizar perfil</button>
        <button className="admin-button" disabled={busy} onClick={() => void run("engagement")}>Monitorar engajamento</button>
      </div>
    </section>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {result && <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Resultado</div><h2>Saída da skill</h2></div></div><pre className="admin-result">{JSON.stringify(result, null, 2)}</pre></section>}
  </div></main>;
}
