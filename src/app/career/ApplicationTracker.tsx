"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminNav } from "@/app/admin/AdminNav";

type Match = { id: string; title: string; company: string | null; location: string | null; url: string; score: number; rationale: string; eligibilityStatus?: string; eligibilityReasons?: string[]; recommendedResume?: { id: string; originalName: string; version: string } | null };
type Kit = { id: string; version: number; language: string; coverLetter: string; reviewStatus: string; documentSha256: string | null; createdAt: string; requiredConfirmations: string[]; unverifiedRequirements: string[] };
type ApplicationEvent = { id: string; eventType: string; fromRecruitmentStage: string | null; toRecruitmentStage: string | null; fromPreparationStage: string | null; toPreparationStage: string | null; source: string; note: string | null; createdAt: string };
type AppItem = { id: string; status: string; preparationStatus: string; notes: string | null; recruiterContact: string | null; submissionEvidence: string | null; authorizedResume: { originalName: string; version: string; language: string } | null; job: Match & { description: string }; kits: Kit[]; events: ApplicationEvent[] };

const recruitmentStages = ["SAVED", "SCREENING", "INTERVIEW", "TECHNICAL_TEST", "OFFER", "APPLIED", "REJECTED", "WITHDRAWN", "ARCHIVED"];
const preparationStages = ["NOT_QUEUED", "QUEUED", "PREPARING", "NEEDS_INFORMATION", "READY_FOR_REVIEW", "APPROVED_FOR_SUBMISSION", "SUBMITTING", "SUBMISSION_FAILED", "MANUAL_ACTION_REQUIRED"];
const recruitmentLabels: Record<string, string> = { SAVED: "Salva", SCREENING: "Triagem", INTERVIEW: "Entrevista", TECHNICAL_TEST: "Teste técnico", OFFER: "Oferta", APPLIED: "Enviada", REJECTED: "Rejeitada", WITHDRAWN: "Retirada", ARCHIVED: "Arquivada", READY_FOR_REVIEW: "Revisão (legado)", RESUME_PREPARED: "CV preparado (legado)" };
const prepLabels: Record<string, string> = { NOT_QUEUED: "Guardar para depois", QUEUED: "Na fila", PREPARING: "Em preparação", NEEDS_INFORMATION: "Precisa de informação", READY_FOR_REVIEW: "Pronta para revisão", APPROVED_FOR_SUBMISSION: "Documentos aprovados", SUBMITTING: "Ação manual no portal", SUBMISSION_FAILED: "Falha na preparação", MANUAL_ACTION_REQUIRED: "Ação manual necessária" };
const boardColumns = ["NOT_QUEUED", "QUEUED", "PREPARING", "NEEDS_INFORMATION", "READY_FOR_REVIEW", "APPROVED_FOR_SUBMISSION"];
const submittedStages = new Set(["APPLIED", "SCREENING", "INTERVIEW", "TECHNICAL_TEST", "OFFER"]);

export function ApplicationTracker({ token }: { token: string }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [applications, setApplications] = useState<AppItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"queue" | "funnel">("queue");
  const headers = useMemo(() => ({ "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }), [token]);

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const [matchResponse, appResponse] = await Promise.all([
        fetch("/api/career/matches", { headers, cache: "no-store" }),
        fetch("/api/career/applications", { headers, cache: "no-store" }),
      ]);
      const [matchPayload, appPayload] = await Promise.all([matchResponse.json(), appResponse.json()]);
      if (!matchResponse.ok || !appResponse.ok) throw new Error(matchPayload.error ?? appPayload.error ?? "Falha ao carregar o painel de candidaturas.");
      setMatches((matchPayload.matches ?? []).map((row: Record<string, unknown>) => {
        const job = row.job as Record<string, unknown>;
        return { id: String(job.id), title: String(job.title), company: job.company as string | null, location: job.location as string | null, url: String(job.url), score: Number(row.score), rationale: String(row.rationale), eligibilityStatus: String(row.eligibilityStatus ?? "UNKNOWN"), eligibilityReasons: Array.isArray(row.eligibilityReasons) ? row.eligibilityReasons as string[] : [], recommendedResume: row.recommendedResume as Match["recommendedResume"] ?? null };
      }));
      setApplications(appPayload.applications ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar vagas."); }
    finally { setBusy(false); }
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  async function saveJob(jobId: string, queue: boolean) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/career/applications", { method: "POST", headers, body: JSON.stringify({ jobId, queue }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível salvar a vaga.");
      await load();
      setMessage(queue ? (payload.enqueued ? "Vaga salva e preparação enviada à fila." : "Vaga salva. A preparação já está ativa ou pode ser retomada pela fila.") : "Vaga salva para depois; nenhuma preparação foi iniciada.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar vaga."); }
    finally { setBusy(false); }
  }

  async function updateApplication(id: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/career/applications/${id}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível atualizar a candidatura.");
    await load();
  }

  async function changeRecruitmentStage(application: AppItem, status: string) {
    let submissionEvidence: string | undefined;
    if (status === "APPLIED") {
      submissionEvidence = window.prompt("Informe a confirmação do portal oficial (mínimo de 8 caracteres). A aplicação não enviará nada automaticamente.") ?? undefined;
      if (!submissionEvidence || submissionEvidence.trim().length < 8) { setError("Status não alterado: falta comprovação de envio."); return; }
    }
    try { await updateApplication(application.id, { status, ...(submissionEvidence ? { submissionEvidence } : {}), eventNote: "Transição registrada manualmente pelo usuário." }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar etapa."); }
  }

  async function changePreparation(application: AppItem, preparationStatus: string) {
    try { await updateApplication(application.id, { preparationStatus, eventNote: "Etapa documental registrada manualmente." }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar preparação."); }
  }

  async function queueApplication(applicationId: string) {
    try {
      const response = await fetch("/api/career/applications/batch-queue", { method: "POST", headers, body: JSON.stringify({ applicationIds: [applicationId] }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível incluir na fila.");
      setMessage(payload.enqueueFailures?.length ? "A vaga ficou registrada, mas o Inngest não confirmou o evento. Tente novamente." : "Vaga enviada à fila de preparação.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao reenfileirar."); }
  }

  async function queueSelected() {
    if (!selectedIds.length) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/career/applications/batch-queue", { method: "POST", headers, body: JSON.stringify({ applicationIds: selectedIds }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível enfileirar as vagas.");
      setSelectedIds([]);
      setMessage(`${payload.queued} vaga(s) enfileirada(s); ${payload.skipped} ignorada(s) por já estar ativa ou encerrada.${payload.enqueueFailures?.length ? ` ${payload.enqueueFailures.length} evento(s) sem confirmação do Inngest.` : ""}`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha no lote."); }
    finally { setBusy(false); }
  }

  async function reviewKit(kit: Kit, action: "approve" | "revise") {
    try {
      const coverLetter = action === "revise" ? window.prompt("Edite a cover letter. Uma nova versão será criada e a aprovação anterior não será reutilizada.", kit.coverLetter) : undefined;
      if (action === "revise" && coverLetter === null) return;
      const body = action === "approve" ? { action } : { action, coverLetter };
      const response = await fetch(`/api/career/application-kits/${kit.id}`, { method: "PATCH", headers, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível atualizar o kit.");
      await load();
      setMessage(action === "approve" ? `Application Kit v${kit.version} aprovado. O envio ainda é manual.` : `Nova revisão do Application Kit criada a partir da versão ${kit.version}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha na revisão do kit."); }
  }

  const tracked = new Set(applications.map((item) => item.job.id));
  const suggestions = matches.filter((job) => !tracked.has(job.id)).slice(0, 8);
  const sent = applications.filter((item) => submittedStages.has(item.status)).length;
  const responses = applications.filter((item) => ["SCREENING", "INTERVIEW", "TECHNICAL_TEST", "OFFER", "REJECTED"].includes(item.status)).length;
  const interviews = applications.filter((item) => item.status === "INTERVIEW" || item.status === "TECHNICAL_TEST").length;
  const prepared = applications.filter((item) => item.kits.length > 0).length;
  const queuedHistorical = applications.filter((item) => item.preparationStatus === "NOT_QUEUED" && item.status === "SAVED");
  const queuedHistoricalIds = queuedHistorical.map((item) => item.id);

  return <main className="admin-shell"><div className="admin-container"><AdminNav current="applications" />
    <header className="admin-header"><div><div className="admin-kicker">Career CRM</div><h1 className="admin-title">Fila de candidatura e funil</h1><p className="admin-subtitle">Preparação documental e processo seletivo são acompanhados separadamente. Nenhum formulário externo é submetido pelo sistema.</p></div><button className="admin-button" onClick={() => void load()} disabled={busy}>{busy ? "Atualizando…" : "Atualizar"}</button></header>
    <section className="career-kpi-grid" aria-label="Indicadores do pipeline">
      <article className="career-kpi"><span>Vagas salvas</span><strong>{applications.length}</strong><small>inclui vagas ainda não enfileiradas</small></article>
      <article className="career-kpi"><span>Kits preparados</span><strong>{prepared}</strong><small>aguardam ou já passaram por revisão</small></article>
      <article className="career-kpi"><span>Candidaturas enviadas</span><strong>{sent}</strong><small>não conta oportunidades apenas salvas</small></article>
      <article className="career-kpi"><span>Taxa de resposta</span><strong>{sent ? `${Math.round((responses / sent) * 100)}%` : "—"}</strong><small>{responses} respostas registradas · amostra: {sent}</small></article>
      <article className="career-kpi"><span>Entrevistas e testes</span><strong>{interviews}</strong><small>etapas registradas manualmente</small></article>
      <article className="career-kpi"><span>Ofertas</span><strong>{applications.filter((item) => item.status === "OFFER").length}</strong><small>registradas no funil</small></article>
    </section>
    {error && <p className="admin-error" role="alert">{error}</p>}{message && <p className="admin-meta" role="status">{message}</p>}

    <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Job Search</div><h2>Oportunidades recomendadas</h2><p className="admin-subtitle">“Preparar candidatura” cria uma intenção e envia à fila. “Guardar para depois” não inicia geração. Match não garante entrevista.</p></div></div>
      <div className="career-job-grid">{suggestions.length ? suggestions.map((job) => <article className="career-job-card" key={job.id}><div className="career-job-top"><span className="career-match-score">{Math.round(job.score)}<small>/100</small></span><div><h3>{job.title}</h3><p>{job.company ?? "Empresa não informada"} · {job.location ?? "Local não informado"}</p></div></div><p className="career-job-rationale">{job.rationale}</p><p className="admin-meta">Elegibilidade: {job.eligibilityStatus ?? "UNKNOWN"}{job.eligibilityReasons?.length ? ` — ${job.eligibilityReasons.join(" ")}` : ""}</p><p className="admin-meta">Currículo sugerido: {job.recommendedResume?.originalName ?? "será selecionado após importar e autorizar um V2"}</p><div className="admin-actions"><a className="admin-button" href={job.url} target="_blank" rel="noreferrer">Abrir portal oficial ↗</a><button className="admin-button" disabled={busy} onClick={() => void saveJob(job.id, false)}>Guardar para depois</button><button className="admin-button active" disabled={busy} onClick={() => void saveJob(job.id, true)}>Preparar candidatura</button></div></article>) : <article className="admin-card">Ainda não há vagas novas. Ajuste os filtros em Carreira e busque vagas para atualizar a lista.</article>}</div>
    </section>

    <div className="career-tabs" role="tablist" aria-label="Career CRM views"><button role="tab" aria-selected={tab === "queue"} className={`career-tab ${tab === "queue" ? "active" : ""}`} onClick={() => setTab("queue")}>Application Queue</button><button role="tab" aria-selected={tab === "funnel"} className={`career-tab ${tab === "funnel" ? "active" : ""}`} onClick={() => setTab("funnel")}>Recruitment Funnel</button></div>

    {tab === "queue" ? <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Application Queue</div><h2>Preparação e revisão dos documentos</h2><p className="admin-subtitle">Oportunidades históricas ficam fora da fila até serem selecionadas. A preparação é idempotente e não envia candidaturas.</p></div>{queuedHistorical.length > 0 && <div className="admin-actions"><button className="admin-button" onClick={() => setSelectedIds(selectedIds.length === queuedHistoricalIds.length ? [] : queuedHistoricalIds)}>{selectedIds.length === queuedHistoricalIds.length ? "Limpar seleção" : `Selecionar salvas (${queuedHistorical.length})`}</button><button className="admin-button active" disabled={!selectedIds.length || busy} onClick={() => void queueSelected()}>Enfileirar selecionadas ({selectedIds.length})</button></div>}</div>
      <div className="career-application-board">{boardColumns.map((status) => {
        const columnItems = applications.filter((item) => item.preparationStatus === status);
        return <section className="career-application-column" key={status}><header><strong>{prepLabels[status]}</strong><span>{columnItems.length}</span></header>{columnItems.length ? columnItems.map((item) => <article className="career-application-card career-queue-card" key={item.id}>
          {status === "NOT_QUEUED" && <label className="admin-meta"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /> Selecionar para fila</label>}
          <div className="career-app-company">{item.job.company ?? "Empresa não informada"} · {item.job.location ?? "Local não informado"}</div><h3>{item.job.title}</h3><p className="admin-meta">Match {Math.round(item.job.score)}/100 · {item.authorizedResume?.originalName ?? "currículo V2 a selecionar"}</p>
          {item.kits[0] && <div className="application-kit-review"><strong>Application Kit v{item.kits[0].version} · {item.kits[0].language} · {item.kits[0].reviewStatus}</strong><p className="admin-meta">{item.kits[0].coverLetter.slice(0, 320)}{item.kits[0].coverLetter.length > 320 ? "…" : ""}</p>{item.kits[0].requiredConfirmations?.length > 0 && <p className="admin-meta">Confirmações pendentes: {item.kits[0].requiredConfirmations.join(" · ")}</p>}{item.kits[0].unverifiedRequirements?.length > 0 && <p className="admin-meta">Requisitos sem evidência: {item.kits[0].unverifiedRequirements.join(" · ")}</p>}<div className="admin-actions"><a className="admin-button" href={`/api/career/application-kits/${item.kits[0].id}/export?format=docx`}>Baixar DOCX</a><a className="admin-button" href={`/api/career/application-kits/${item.kits[0].id}/export?format=pdf`}>Baixar PDF</a><button className="admin-button" onClick={() => void reviewKit(item.kits[0], "revise")}>Editar carta</button>{item.kits[0].reviewStatus !== "APPROVED" && <button className="admin-button active" onClick={() => void reviewKit(item.kits[0], "approve")}>Aprovar documentos</button>}</div></div>}
          {status === "NOT_QUEUED" && <button className="admin-button active" onClick={() => void queueApplication(item.id)}>Incluir na fila</button>}
          {status === "NEEDS_INFORMATION" && <a className="admin-button" href="/career#resume-builder">Importar ou revisar currículos</a>}
          {status === "SUBMISSION_FAILED" && <button className="admin-button" onClick={() => void queueApplication(item.id)}>Tentar preparação novamente</button>}
          {item.events[0] && <small className="admin-meta">Última atualização: {new Date(item.events[0].createdAt).toLocaleString("pt-BR")} · {item.events[0].note ?? item.events[0].eventType}</small>}
        </article>) : <p className="admin-empty-state">Nenhuma vaga nesta etapa.</p>}</section>;
      })}</div>
    </section> : <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Recruitment Funnel</div><h2>Acompanhamento do processo seletivo</h2><p className="admin-subtitle">Somente confirmação do usuário registra uma candidatura como enviada; o histórico de transições é preservado.</p></div></div>
      <div className="career-application-list">{applications.length ? applications.map((item) => <article className="career-application-card" key={item.id}><div className="career-app-main"><div className="career-app-company">{item.job.company ?? "Empresa não informada"} · {item.job.location ?? "Local não informado"}</div><h3>{item.job.title}</h3><p className="admin-meta">Preparação: {prepLabels[item.preparationStatus] ?? item.preparationStatus} · {item.authorizedResume?.originalName ?? "sem currículo associado"}{item.submissionEvidence && ` · comprovante: ${item.submissionEvidence}`}</p><label className="admin-meta">Contato do recrutador<input className="admin-input" defaultValue={item.recruiterContact ?? ""} placeholder="Contato ou canal (opcional)" onBlur={(event) => { if (event.currentTarget.value !== (item.recruiterContact ?? "")) void updateApplication(item.id, { recruiterContact: event.currentTarget.value }); }} /></label><textarea className="admin-textarea career-notes" defaultValue={item.notes ?? ""} placeholder="Notas, entrevistas, testes, feedback e próximo passo..." onBlur={(event) => { if (event.currentTarget.value !== (item.notes ?? "")) void updateApplication(item.id, { notes: event.currentTarget.value }); }} /><details><summary>Histórico de eventos ({item.events.length})</summary><ol>{item.events.map((event) => <li key={event.id}><time>{new Date(event.createdAt).toLocaleString("pt-BR")}</time> · {event.fromRecruitmentStage && event.toRecruitmentStage ? `${recruitmentLabels[event.fromRecruitmentStage] ?? event.fromRecruitmentStage} → ${recruitmentLabels[event.toRecruitmentStage] ?? event.toRecruitmentStage}` : `${prepLabels[event.fromPreparationStage ?? ""] ?? event.fromPreparationStage} → ${prepLabels[event.toPreparationStage ?? ""] ?? event.toPreparationStage}`} {event.note}</li>)}</ol></details></div><div className="career-app-actions"><label>Etapa<select className="admin-input" value={item.status} onChange={(event) => void changeRecruitmentStage(item, event.target.value)} aria-label={`Etapa de recrutamento para ${item.job.title}`}>{recruitmentStages.map((stage) => <option key={stage} value={stage}>{recruitmentLabels[stage]}</option>)}</select></label><label>Preparação<select className="admin-input" value={item.preparationStatus} onChange={(event) => void changePreparation(item, event.target.value)} aria-label={`Status de preparação para ${item.job.title}`}>{preparationStages.map((stage) => <option key={stage} value={stage}>{prepLabels[stage]}</option>)}</select></label><a href={item.job.url} target="_blank" rel="noreferrer">Abrir vaga ↗</a></div></article>) : <p className="admin-empty-state">Nenhuma oportunidade salva. Adicione uma vaga para iniciar o CRM.</p>}</div>
    </section>}
    <p className="career-privacy-note">A geração de documentos é um rascunho. Não existe envio automático para empregadores; dados de salário, visto, autorização de trabalho, disponibilidade e realocação exigem confirmação manual.</p>
  </div></main>;
}
