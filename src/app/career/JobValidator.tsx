"use client";

import { FormEvent, useState } from "react";

interface JobAnalysis {
  isNew: boolean;
  jobId: string;
  title: string;
  company: string | null;
  score: number;
  label: string;
  matchedSkills: string[];
  skillGaps: string[];
  rationale: string;
  pitch: string;
  jobUrl: string;
}

export function JobValidator({ token, onValidated }: { token: string; onValidated?: () => void }) {
  const [url, setUrl] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setAnalysis(null);

    try {
      const response = await fetch("/api/career/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url, subject, description }),
      });
      const payload = await response.json() as JobAnalysis & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível analisar a vaga.");
      setAnalysis(payload);
      setMessage({ text: "Vaga analisada e salva no Matchmaker.", kind: "success" });
      onValidated?.();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Falha ao validar a vaga.", kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return <section className="admin-panel">
    <div className="admin-section-heading">
      <div>
        <div className="admin-kicker">Validação manual</div>
        <h2>Validar uma vaga</h2>
        <p className="admin-subtitle">Cole um link público do LinkedIn. Se o LinkedIn bloquear a leitura, cole a descrição completa para gerar o Match Score.</p>
      </div>
    </div>
    <form className="admin-edit" onSubmit={(event) => void submit(event)}>
      <input className="admin-input" type="url" placeholder="URL da vaga no LinkedIn (opcional se colar a descrição)" value={url} onChange={(event) => setUrl(event.target.value)} />
      <input className="admin-input" placeholder="Título da vaga, se desejar informar" value={subject} onChange={(event) => setSubject(event.target.value)} />
      <textarea className="admin-textarea" rows={8} placeholder="Descrição completa da vaga (mínimo de 240 caracteres quando não houver URL)" value={description} onChange={(event) => setDescription(event.target.value)} />
      <button className="admin-button active" type="submit" disabled={busy || !token || (!url.trim() && description.trim().length < 240)}>{busy ? "Analisando..." : "Validar vaga"}</button>
    </form>
    {message && <p className={message.kind === "error" ? "admin-error" : "admin-success"} role="status">{message.text}</p>}
    {analysis && <article className="admin-card">
      <div className="admin-card-head">
        <div>
          <strong>{analysis.title}</strong>
          <div className="admin-meta">{analysis.company ?? "Empresa não identificada"}</div>
        </div>
        <span className="admin-status">{Math.round(analysis.score)}/100 · {analysis.label}</span>
      </div>
      <p>{analysis.rationale}</p>
      <p className="admin-meta"><strong>Skills aderentes:</strong> {analysis.matchedSkills.join(", ") || "Nenhuma identificada"}</p>
      <p className="admin-meta"><strong>Gaps:</strong> {analysis.skillGaps.join(", ") || "Nenhum gap identificado"}</p>
      <p><strong>Pitch sugerido:</strong> {analysis.pitch}</p>
      {analysis.jobUrl !== "https://www.linkedin.com/jobs/" && <a href={analysis.jobUrl} target="_blank" rel="noreferrer">Abrir vaga original</a>}
    </article>}
  </section>;
}
