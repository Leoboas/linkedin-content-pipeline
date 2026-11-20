"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminNav } from "@/app/admin/AdminNav";

type Match = { id: string; title: string; company: string | null; location: string | null; url: string; score: number; label: string; rationale: string };
type AppItem = { id: string; status: string; notes: string | null; job: Match & { description: string }; resumeDraft: { targetRole: string; atsScore: number } | null };
const statuses = ["SAVED", "READY_FOR_REVIEW", "RESUME_PREPARED", "APPLIED", "INTERVIEW", "REJECTED", "WITHDRAWN"];
const labels: Record<string, string> = { SAVED: "Salva", READY_FOR_REVIEW: "Revisar", RESUME_PREPARED: "Currículo pronto", APPLIED: "Candidatura enviada", INTERVIEW: "Entrevista", REJECTED: "Recusada", WITHDRAWN: "Retirada" };

export function ApplicationTracker({ token }: { token: string }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [applications, setApplications] = useState<AppItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const [matchResponse, appResponse] = await Promise.all([
        fetch("/api/career/matches", { headers, cache: "no-store" }),
        fetch("/api/career/applications", { headers, cache: "no-store" }),
      ]);
      const matchPayload = await matchResponse.json(); const appPayload = await appResponse.json();
      if (!matchResponse.ok || !appResponse.ok) throw new Error(matchPayload.error ?? appPayload.error ?? "Falha ao carregar o painel de candidaturas.");
      setMatches((matchPayload.matches ?? []).map((row: Record<string, unknown>) => { const job = row.job as Record<string, unknown>; return { id: String(job.id), title: String(job.title), company: job.company as string | null, location: job.location as string | null, url: String(job.url), score: Number(row.score), label: String(row.label), rationale: String(row.rationale) }; }));
      setApplications(appPayload.applications ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar vagas."); }
    finally { setBusy(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function saveJob(jobId: string) {
    const response = await fetch("/api/career/applications", { method: "POST", headers, body: JSON.stringify({ jobId }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error ?? "Não foi possível salvar a vaga."); return; }
    await load();
  }

  async function changeStatus(id: string, status: string) {
    const response = await fetch(`/api/career/applications/${id}`, { method: "PATCH", headers, body: JSON.stringify({ status }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error ?? "Não foi possível atualizar a candidatura."); return; }
    setApplications((current) => current.map((item) => item.id === id ? { ...item, status: payload.application.status } : item));
  }

  async function saveNotes(id: string, notes: string) {
    const response = await fetch(`/api/career/applications/${id}`, { method: "PATCH", headers, body: JSON.stringify({ notes }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error ?? "Não foi possível salvar as notas."); return; }
    setApplications((current) => current.map((item) => item.id === id ? { ...item, notes: payload.application.notes } : item));
  }

  const tracked = new Set(applications.map((item) => item.job.id));
  const suggestions = matches.filter((job) => !tracked.has(job.id)).slice(0, 8);
  return <main className="admin-shell"><div className="admin-container"><AdminNav current="applications" />
    <header className="admin-header"><div><div className="admin-kicker">Career CRM</div><h1 className="admin-title">Vagas e candidaturas</h1><p className="admin-subtitle">Da descoberta à entrevista, com aderência, currículo direcionado e decisão final sob seu controle.</p></div><button className="admin-button" onClick={() => void load()} disabled={busy}>{busy ? "Atualizando..." : "Atualizar"}</button></header>
    <section className="career-kpi-grid" aria-label="Resumo do pipeline"><article className="career-kpi"><span>Oportunidades</span><strong>{applications.length}</strong><small>salvas para acompanhar</small></article><article className="career-kpi"><span>Em processo</span><strong>{applications.filter((item) => ["READY_FOR_REVIEW", "RESUME_PREPARED", "APPLIED", "INTERVIEW"].includes(item.status)).length}</strong><small>revisão, envio ou entrevista</small></article><article className="career-kpi"><span>Entrevistas</span><strong>{applications.filter((item) => item.status === "INTERVIEW").length}</strong><small>etapa registrada manualmente</small></article></section>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Oportunidades priorizadas</div><h2>Salve vagas para acompanhar</h2><p className="admin-subtitle">O Match Score ajuda a priorizar; não é garantia de entrevista nem decisão de candidatura.</p></div></div>
      <div className="career-job-grid">{suggestions.length ? suggestions.map((job) => <article className="career-job-card" key={job.id}><div className="career-job-top"><span className="career-match-score">{Math.round(job.score)}<small>/100</small></span><div><h3>{job.title}</h3><p>{job.company ?? "Empresa não informada"} · {job.location ?? "Local não informado"}</p></div></div><p className="career-job-rationale">{job.rationale}</p><div className="admin-actions"><a className="admin-button" href={job.url} target="_blank" rel="noreferrer">Ver vaga original</a><button className="admin-button active" onClick={() => void saveJob(job.id)}>Adicionar ao pipeline</button></div></article>) : <article className="admin-card">Ainda não há vagas novas. Ajuste os filtros em Carreira e clique em “Buscar vagas agora”.</article>}</div>
    </section>
    <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Pipeline pessoal</div><h2>Etapas das candidaturas</h2><p className="admin-subtitle">Marque “Candidatura enviada” somente depois de confirmar o envio no sistema do empregador.</p></div></div>
      <div className="career-application-list">{applications.length ? applications.map((item) => <article className="career-application-card" key={item.id}><div><div className="career-app-company">{item.job.company ?? "Empresa não informada"} · {item.job.location ?? "Local não informado"}</div><h3>{item.job.title}</h3><p className="admin-meta">Match {Math.round(item.job.score)}/100 · {item.resumeDraft ? `CV ${item.resumeDraft.atsScore}/100` : "CV ainda não preparado"}</p><textarea className="admin-textarea career-notes" defaultValue={item.notes ?? ""} placeholder="Notas: contato, requisitos críticos, próximo passo..." onBlur={(event) => { if (event.currentTarget.value !== (item.notes ?? "")) void saveNotes(item.id, event.currentTarget.value); }} /></div><div className="career-app-actions"><select className="admin-input" value={item.status} onChange={(event) => void changeStatus(item.id, event.target.value)} aria-label={`Etapa da candidatura para ${item.job.title}`}>{statuses.map((status) => <option key={status} value={status}>{labels[status]}</option>)}</select><a href={item.job.url} target="_blank" rel="noreferrer">Abrir vaga ↗</a><a href="/career#resume-builder">Preparar currículo</a></div></article>) : <p className="admin-empty-state">Nenhuma vaga salva. Adicione uma oportunidade da lista para iniciar seu pipeline.</p>}</div>
    </section>
    <p className="career-privacy-note">Este painel não envia candidaturas nem compartilha seu currículo automaticamente. A preparação do material pode ser feita pelo Resume Builder; a submissão final deve ser revisada por você.</p>
  </div></main>;
}
