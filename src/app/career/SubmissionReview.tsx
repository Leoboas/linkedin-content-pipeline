"use client";

import { useState } from "react";

type Field = { key: string; label: string; description: string; type: string; required: boolean; options: string[] };
type Review = { form: { schemaHash: string; title: string; board: string; fields: Field[] }; company: string | null; destinationUrl: string; coverLetter: string; version: number; dryRun: boolean };

export function SubmissionReview({ kitId, headers, onDone }: { kitId: string; headers: Record<string, string>; onDone: () => Promise<void> }) {
  const [review, setReview] = useState<Review | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/career/application-kits/${kitId}/submission`, { headers, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Formulário indisponível.");
      setReview(data as Review); setAnswers({});
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao obter formulário."); }
    finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!review) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/career/application-kits/${kitId}/submission`, { method: "POST", headers, body: JSON.stringify({ formHash: review.form.schemaHash, answers }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível autorizar.");
      setReview(null); await onDone();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao autorizar."); }
    finally { setBusy(false); }
  }
  return <div>
    <button className="admin-button active" type="button" disabled={busy} onClick={() => void open()}>Revisar para envio automático</button>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {review && <form className="admin-card" onSubmit={(event) => void submit(event)}>
      <h3>Revisar candidatura · v{review.version}</h3>
      <p>{review.company ?? review.form.board} · {review.form.title}</p>
      <p>Destino: <a href={review.destinationUrl} target="_blank" rel="noreferrer">{review.destinationUrl}</a></p>
      <p>Revise os documentos e as respostas que serão enviados a este portal.</p>
      <div className="admin-actions"><a className="admin-button" href={`/api/career/application-kits/${kitId}/export?format=pdf&part=resume`} target="_blank" rel="noreferrer">Visualizar currículo PDF</a><a className="admin-button" href={`/api/career/application-kits/${kitId}/export?format=pdf&part=cover`} target="_blank" rel="noreferrer">Visualizar carta PDF</a></div>
      <details><summary>Carta de apresentação</summary><p style={{ whiteSpace: "pre-wrap" }}>{review.coverLetter}</p></details>
      {review.form.fields.map((field) => <label key={field.key} className="admin-label" style={{ display: "block", marginTop: 12 }}>{field.label}{field.required ? " *" : ""}{field.description && <small style={{ display: "block", whiteSpace: "pre-wrap" }}>{field.description}</small>}
        {field.type === "file-upload" ? <select className="admin-input" required={field.required} value={typeof answers[field.key] === "string" ? answers[field.key] as string : ""} onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Nenhum documento</option><option value="$resume">Currículo PDF</option><option value="$coverLetter">Carta PDF</option></select>
          : field.options.length ? <select className="admin-input" multiple={field.type === "multiple-select"} required={field.required} value={answers[field.key] ?? (field.type === "multiple-select" ? [] : "")} onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: field.type === "multiple-select" ? Array.from(event.target.selectedOptions).map((option) => option.value) : event.target.value }))}>{field.type !== "multiple-select" && <option value="">Selecione</option>}{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
            : <input className="admin-input" required={field.required} value={typeof answers[field.key] === "string" ? answers[field.key] as string : ""} onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: event.target.value }))} />}
      </label>)}
      <p>{review.dryRun ? "Modo de teste: formulário e anexos serão preparados no sandbox, sem enviar candidatura." : "Ao autorizar, o pacote revisado poderá ser enviado automaticamente para esta vaga. Preencha apenas informações que você confirma."}</p>
      <div className="admin-actions"><button className="admin-button" type="button" onClick={() => setReview(null)}>Cancelar</button><button className="admin-button active" disabled={busy} type="submit">{review.dryRun ? "Autorizar teste sem envio" : "Aprovar e autorizar envio"}</button></div>
    </form>}
  </div>;
}
