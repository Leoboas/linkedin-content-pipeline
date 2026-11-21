"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PublishedPost = { id: string; title: string; language: string; editorialPillar: string; formatType: string; topic: string | null; editorialObjective: string | null; publishedAt: string | null };
type Experiment = { id: string; name: string; hypothesis: string; professionalObjective: string; variableTested: string; primaryMetric: string; periodStart: string; periodEnd: string; status: string; evaluations: Array<{ id: string; observedAt: string; measurementWindow: string; metric: string }>; posts: Array<{ postId: string; armLabel: string; post: PublishedPost }>; analysis: { status: string; sampleSize: number; measurementWindow: string; metric: string; minimumObservationsPerArm: number; coverage: Array<{ label: string; n: number; mean: number | null; median: number | null; sources: string[] }>; comparison: { highestObservedArm: string | null; lowestObservedArm: string | null; note: string } | null; limitations: string[] }; secondaryAnalyses: Array<{ status: string; metric: string; sampleSize: number; coverage: Array<{ label: string; n: number; mean: number | null }> }> };
type Recommendation = { id: string; title: string; diagnosis: string; dataSnapshot: unknown; justification: string; hypothesis: string; confidence: string; nextAction: string; status: string; sampleSize: number; limitations: unknown; decisionNote: string | null };
type Outcome = { id: string; company: string | null; contactName: string | null; contactRole: string | null; roleTitle: string | null; market: string | null; occurredAt: string; type: string; origin: string; association: string; processStage: string; observation: string | null; result: string | null; evidenceNote: string | null; post: { id: string; title: string } | null; networkingActivity: { id: string; type: string; occurredAt: string } | null; jobApplication: { id: string; status: string; job: { title: string; company: string | null } } | null };
type NetworkingActivity = { id: string; type: string; occurredAt: string; topicKey: string | null; language: string | null; publicationConfirmed: boolean };
type Application = { id: string; status: string; job: { title: string; company: string | null } };
type DashboardData = { cycle: null | { startDate: string; phase: string; daysElapsed: number; daysRemaining: number; plannedPosts: number; publishedPosts: number; distribution: { en: number; ptBr: number } }; currentEditorialConfig: unknown; criteria: { roles: unknown; markets: unknown }; experiments: Experiment[]; recommendations: Recommendation[]; outcomes: Outcome[]; publishedPosts: PublishedPost[]; networkingActivities: NetworkingActivity[]; career: { applicationCount: number; applications: Application[]; outcomesCount: number }; qualifiedAudience: { status: string; snapshotPosts: number; matchedRoleCategories: Array<{ role: string; postSnapshots: number }>; matchedMarketCategories: Array<{ market: string; postSnapshots: number }>; methodology: string }; weeklyTimeline: Array<{ weekStartBrt: string; publishedPosts: number; postsWith7dSnapshot: number; averageImpressionsPerPost: number | null; averageReachPerPost: number | null; averageProfileViewsFromPost: number | null; averageOutOfNetworkPercent: number | null; networkingActivities: number; manuallyConfirmedComments: number; relevantConnections: number; conversationsStarted: number; careerOutcomes: number; recruiterContacts: number; interviews: number; postConfirmedOutcomes: number }>; networking: { totalActivities: number; discussionsReviewed: number; commentsPrepared: number; manuallyConfirmedComments: number; relevantConnections: number; conversationsStarted: number; byTopic: Array<[string, number]>; byLanguage: Array<[string, number]> }; limitations: string[] };

const dateOnly = (value?: string) => value ? new Date(value).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
const listText = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("\n") : "";
const label = (value: string) => value.replaceAll("_", " ").toLowerCase();

export function EditorialExperimentationDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/experimentation", { cache: "no-store" });
      const result = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      setData(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar o painel."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function send(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/experimentation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const result = await response.json() as { error?: string; generated?: number };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      setNotice(action === "generate-recommendations" ? `${result.generated ?? 0} recomendações explicáveis criadas (ou já existentes).` : "Alteração salva.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar."); }
    finally { setBusy(false); }
  }

  async function decide(id: string, status: string, decisionNote?: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/experimentation", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "recommendation", id, status, decisionNote }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      setNotice("Decisão registrada; nenhuma mudança editorial foi aplicada automaticamente."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao registrar decisão."); }
    finally { setBusy(false); }
  }

  async function setExperimentStatus(id: string, status: "COMPLETED" | "CANCELLED") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/experimentation", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "experiment", id, status }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      setNotice(`Experimento ${status === "COMPLETED" ? "concluído" : "cancelado"}.`); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar experimento."); }
    finally { setBusy(false); }
  }

  async function formAction(event: React.FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    const form = event.currentTarget; const formData = new FormData(form);
    if (action === "create-experiment") {
      const posts = ["armA", "armB"].flatMap((key) => formData.getAll(key).map((postId) => ({ postId: String(postId), armLabel: key === "armA" ? String(formData.get("armALabel") || "A") : String(formData.get("armBLabel") || "B") })));
      await send(action, { name: formData.get("name"), hypothesis: formData.get("hypothesis"), professionalObjective: formData.get("professionalObjective"), variableTested: formData.get("variableTested"), primaryMetric: formData.get("primaryMetric"), secondaryMetrics: formData.getAll("secondaryMetrics"), measurementWindow: formData.get("measurementWindow"), minimumObservations: Number(formData.get("minimumObservations")), periodStart: `${String(formData.get("periodStart"))}T00:00:00.000Z`, periodEnd: `${String(formData.get("periodEnd"))}T23:59:59.999Z`, posts });
      if (!error) form.reset();
      return;
    }
    if (action === "create-outcome") {
      const origin = String(formData.get("origin"));
      const association = origin === "POST_CONFIRMED" || origin === "NETWORKING_CONFIRMED" ? "CONFIRMED" : String(formData.get("association"));
      await send(action, { company: formData.get("company"), contactName: formData.get("contactName"), contactRole: formData.get("contactRole"), roleTitle: formData.get("roleTitle"), market: formData.get("market"), occurredAt: `${String(formData.get("occurredAt"))}T12:00:00.000Z`, type: formData.get("type"), origin, association, processStage: formData.get("processStage"), postId: formData.get("postId") || null, networkingActivityId: formData.get("networkingActivityId") || null, jobApplicationId: formData.get("jobApplicationId") || null, observation: formData.get("observation"), evidenceNote: formData.get("evidenceNote") });
      return;
    }
    if (action === "save-cycle") { await send(action, { startDate: `${String(formData.get("startDate"))}T00:00:00.000Z` }); return; }
    if (action === "save-audience-criteria") {
      await send(action, { roles: String(formData.get("roles")).split("\n").map((value) => value.trim()).filter(Boolean), markets: String(formData.get("markets")).split(",").map((value) => value.trim()).filter(Boolean) });
    }
  }

  const roleText = useMemo(() => listText(data?.criteria.roles), [data?.criteria.roles]);
  const marketText = useMemo(() => listText(data?.criteria.markets), [data?.criteria.markets]);
  const today = dateOnly();

  return <div className="experimentation-workspace">
    <div className="analytics-filter-row"><button className="admin-button" type="button" onClick={() => void refresh()} disabled={loading || busy}>{loading ? "Atualizando…" : "Atualizar dados"}</button><button className="admin-button secondary" type="button" disabled={busy} onClick={() => void send("refresh-experiments")}>Recalcular e versionar resultados</button><button className="admin-button secondary" type="button" disabled={busy} onClick={() => void send("generate-recommendations")}>Gerar recomendações explicáveis</button><a className="admin-button secondary" href="/api/admin/experimentation/report?days=30&format=markdown">Relatório D+30 (Markdown)</a><a className="admin-button secondary" href="/api/admin/experimentation/report?days=60&format=markdown">D+60</a><a className="admin-button secondary" href="/api/admin/experimentation/report?days=90&format=markdown">D+90</a><a className="admin-button secondary" href="/api/admin/experimentation/report?days=90&format=csv">Exportar CSV</a></div>
    {error && <p role="alert" className="analytics-notice error">{error}</p>}{notice && <p role="status" className="analytics-notice">{notice}</p>}
    {loading && !data ? <div className="admin-panel">Carregando dados autorizados…</div> : data && <>
      <section className="analytics-kpi-grid">
        <Kpi label="Ciclo" value={data.cycle?.phase ?? "Não iniciado"} detail={data.cycle ? `${data.cycle.daysElapsed}/90 dias · ${data.cycle.daysRemaining} restantes` : "Defina a data inicial"} />
        <Kpi label="Posts planejados" value={data.cycle?.plannedPosts ?? 0} detail="4 por semana; sem alterar agenda" />
        <Kpi label="Posts publicados no ciclo" value={data.cycle?.publishedPosts ?? 0} detail={`EN ${data.cycle?.distribution.en ?? 0} · PT-BR ${data.cycle?.distribution.ptBr ?? 0}`} />
        <Kpi label="Experimentos ativos" value={data.experiments.filter((item) => item.status === "RUNNING").length} detail={`${data.experiments.filter((item) => item.analysis.status === "READY_FOR_REVIEW").length} prontos para revisão`} />
        <Kpi label="Recomendações" value={data.recommendations.filter((item) => item.status === "SUGGESTED").length} detail="Aguardando decisão humana" />
        <Kpi label="Sinais profissionais" value={data.outcomes.length} detail={`${data.career.applicationCount} candidaturas já existentes no Career Intelligence`} />
      </section>

      <section className="analytics-two-column">
        <form className="admin-panel" onSubmit={(event) => void formAction(event, "save-cycle")}><h2>Ciclo de 90 dias</h2><p className="admin-subtitle">Fases: baseline (D1–30), experimentação (D31–60), consolidação (D61–90). A frequência e a agenda aprovada permanecem inalteradas.</p><label className="admin-label">Data de início<input className="admin-input" type="date" name="startDate" defaultValue={dateOnly(data.cycle?.startDate)} required /></label><button className="admin-button" disabled={busy}>Salvar início/configuração do ciclo</button></form>
        <form className="admin-panel" onSubmit={(event) => void formAction(event, "save-audience-criteria")}><h2>Audiência profissional qualificada</h2><p className="admin-subtitle">Critérios servem para interpretar apenas demografia real importada/fornecida. Não identificamos visualizadores anônimos.</p><label className="admin-label">Cargos (um por linha)<textarea className="admin-input" name="roles" rows={5} defaultValue={roleText} required /></label><label className="admin-label">Mercados (separados por vírgula)<input className="admin-input" name="markets" defaultValue={marketText} required /></label><button className="admin-button" disabled={busy}>Salvar critérios</button></form>
      </section>

      <section className="admin-panel"><h2>Tendências semanais: conteúdo, networking e carreira</h2><p className="admin-subtitle">Semanas iniciadas em BRT. Linha do tempo permite observar coexistência de sinais, mas não prova que networking ou um post causaram resultado profissional.</p>{data.weeklyTimeline.length ? <div className="analytics-post-list">{data.weeklyTimeline.map((week) => <article key={week.weekStartBrt}><header><strong>Semana de {week.weekStartBrt}</strong><span>{week.publishedPosts} posts · {week.postsWith7dSnapshot} snapshots 7D</span></header><p>Impressões médias/post: {week.averageImpressionsPerPost ?? "n/d"} · alcance médio/post: {week.averageReachPerPost ?? "n/d"} · visitas ao perfil/post: {week.averageProfileViewsFromPost ?? "n/d"} · fora da rede: {week.averageOutOfNetworkPercent === null ? "n/d" : `${week.averageOutOfNetworkPercent}%`}</p><p>Networking: {week.networkingActivities} atividades, {week.manuallyConfirmedComments} comentários confirmados, {week.relevantConnections} conexões, {week.conversationsStarted} conversas. Carreira: {week.careerOutcomes} resultados, {week.recruiterContacts} contatos de recrutadores, {week.interviews} entrevistas, {week.postConfirmedOutcomes} vínculos confirmados com posts.</p></article>)}</div> : <Empty>Sem observações suficientes para a linha do tempo no período do ciclo.</Empty>}</section>

      <section className="admin-panel"><h2>Audiência profissional observada</h2><p className="admin-subtitle">{data.qualifiedAudience.methodology}</p><p>Estado: {data.qualifiedAudience.status} · {data.qualifiedAudience.snapshotPosts} posts com snapshot 7D.</p><div className="analytics-comparison-grid"><article><strong>Categorias de cargo que coincidem exatamente</strong>{data.qualifiedAudience.matchedRoleCategories.length ? data.qualifiedAudience.matchedRoleCategories.map((entry) => <span key={entry.role}>{entry.role} · {entry.postSnapshots} snapshots</span>) : <small>Sem categoria compatível observada.</small>}</article><article><strong>Mercados que coincidem exatamente</strong>{data.qualifiedAudience.matchedMarketCategories.length ? data.qualifiedAudience.matchedMarketCategories.map((entry) => <span key={entry.market}>{entry.market} · {entry.postSnapshots} snapshots</span>) : <small>Sem categoria compatível observada.</small>}</article></div></section>

      <section className="admin-panel"><h2>Planejar experimento editorial</h2><p className="admin-subtitle">Defina uma variável principal, métrica e duas variações. Associe somente posts publicados; os grupos serão comparados na mesma janela de exposição.</p>
        <form className="analytics-filter-row" onSubmit={(event) => void formAction(event, "create-experiment")}>
          <label className="admin-label">Nome<input className="admin-input" name="name" required maxLength={160} placeholder="Ex.: Hook de falha específica vs. geral" /></label>
          <label className="admin-label">Variável testada<select className="admin-input" name="variableTested"><option value="hook">Hook</option><option value="language">Idioma</option><option value="format">Formato</option><option value="evidence">Tipo de evidência</option><option value="pillar">Pilar/tema</option><option value="objective">Objetivo</option><option value="schedule">Horário (hipótese)</option></select></label>
          <label className="admin-label">Métrica principal<select className="admin-input" name="primaryMetric"><option value="profileViewsFromContent">Visitas ao perfil atribuídas</option><option value="membersReached">Pessoas alcançadas (por post)</option><option value="impressions">Impressões</option><option value="outOfNetworkPercent">% fora da rede</option><option value="interactionRate">Taxa de interação observada</option><option value="comments">Comentários</option><option value="postSaves">Salvamentos</option><option value="shares">Compartilhamentos</option><option value="reactions">Reações</option></select></label>
          <label className="admin-label">Métricas secundárias (opcional)<select className="admin-input" name="secondaryMetrics" multiple size={4}><option value="impressions">Impressões</option><option value="membersReached">Alcance médio por post</option><option value="profileViewsFromContent">Visitas ao perfil</option><option value="outOfNetworkPercent">% fora da rede</option><option value="interactionRate">Taxa de interação</option><option value="comments">Comentários</option><option value="postSaves">Salvamentos</option><option value="shares">Compartilhamentos</option></select></label>
          <label className="admin-label">Janela<select className="admin-input" name="measurementWindow"><option value="7D">D+7</option><option value="72H">D+3</option><option value="24H">D+1</option></select></label>
          <label className="admin-label">Início<input className="admin-input" type="date" name="periodStart" defaultValue={today} required /></label><label className="admin-label">Fim<input className="admin-input" type="date" name="periodEnd" defaultValue={dateOnly(new Date(Date.now() + 30 * 86_400_000).toISOString())} required /></label>
          <label className="admin-label">Mínimo por grupo<input className="admin-input" type="number" name="minimumObservations" min={2} max={20} defaultValue={4} /></label>
          <label className="admin-label">Hipótese<textarea className="admin-input" name="hypothesis" rows={2} required placeholder="Qual resultado observável espera e por quê?" /></label>
          <label className="admin-label">Objetivo profissional<textarea className="admin-input" name="professionalObjective" rows={2} required placeholder="Ex.: atrair Data Engineers e recrutadores internacionais" /></label>
          <label className="admin-label">Rótulo grupo A<input className="admin-input" name="armALabel" defaultValue="A" /><select className="admin-input" name="armA" multiple size={5}>{data.publishedPosts.map((post) => <option key={post.id} value={post.id}>{post.title} · {post.language}</option>)}</select></label>
          <label className="admin-label">Rótulo grupo B<input className="admin-input" name="armBLabel" defaultValue="B" /><select className="admin-input" name="armB" multiple size={5}>{data.publishedPosts.map((post) => <option key={post.id} value={post.id}>{post.title} · {post.language}</option>)}</select></label>
          <button className="admin-button" disabled={busy}>Criar experimento</button>
        </form>
      </section>

      <section className="admin-panel"><h2>Experimentos</h2>{data.experiments.length ? <div className="experimentation-list">{data.experiments.map((experiment) => <article className="experimentation-card" key={experiment.id}><div className="experimentation-card-head"><div><span className="admin-kicker">{experiment.variableTested} · {experiment.primaryMetric} · {experiment.analysis.measurementWindow}</span><h3>{experiment.name}</h3></div><span className="status-chip">{experiment.analysis.status}</span></div><p><strong>Hipótese:</strong> {experiment.hypothesis}</p><p><strong>Objetivo:</strong> {experiment.professionalObjective}</p><div className="analytics-bars">{experiment.analysis.coverage.map((arm) => <div className="analytics-bar-row" key={arm.label}><div className="analytics-bar-label"><span>{arm.label}</span><strong>n={arm.n} · média {arm.mean ?? "sem dados"} · mediana {arm.median ?? "n/d"} · fontes {arm.sources.join(", ") || "n/d"}</strong></div><div className="analytics-bar-track"><i style={{ width: `${Math.max(2, Math.min(100, arm.n / Math.max(1, experiment.analysis.minimumObservationsPerArm) * 100))}%` }} /></div></div>)}</div>{experiment.secondaryAnalyses.length > 0 && <div><strong>Métricas secundárias:</strong>{experiment.secondaryAnalyses.map((analysis) => <p key={analysis.metric}>{analysis.metric}: {analysis.status} · n={analysis.sampleSize} · {analysis.coverage.map((arm) => `${arm.label}=${arm.mean ?? "n/d"} (n=${arm.n})`).join(" / ")}</p>)}</div>}<p>{experiment.analysis.comparison?.note ?? "INSUFFICIENT_DATA: ainda não há dois grupos com cobertura comparável."}</p><p>Posts vinculados: {experiment.posts.length ? experiment.posts.map((item) => `${item.armLabel}: ${item.post.title}`).join(" · ") : "nenhum"}</p><p>Histórico persistido de avaliações: {experiment.evaluations.length} snapshot(s).</p><ul>{experiment.analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul><div className="analytics-filter-row">{experiment.status === "READY_FOR_REVIEW" && <button className="admin-button" type="button" disabled={busy} onClick={() => void setExperimentStatus(experiment.id, "COMPLETED")}>Concluir após revisão</button>}{!["COMPLETED", "CANCELLED"].includes(experiment.status) && <button className="admin-button secondary" type="button" disabled={busy} onClick={() => void setExperimentStatus(experiment.id, "CANCELLED")}>Cancelar experimento</button>}</div></article>)}</div> : <Empty>Nenhum experimento registrado. Inicie um teste com hipótese e variável explícitas.</Empty>}</section>

      <section className="analytics-two-column">
        <form className="admin-panel" onSubmit={(event) => void formAction(event, "create-outcome")}><h2>Registrar resultado profissional</h2><p className="admin-subtitle">Informações privadas, visíveis somente nesta área autenticada. Origem desconhecida é um valor válido; não atribua contato a um post por coincidência temporal.</p><div className="analytics-filter-row">
          <label className="admin-label">Tipo<select className="admin-input" name="type"><option value="RECRUITER_CONTACT">Contato de recrutador</option><option value="HIRING_MANAGER_CONVERSATION">Conversa com gestor</option><option value="PROFESSIONAL_CONNECTION">Conexão profissional</option><option value="INTERVIEW_INVITATION">Convite para entrevista</option><option value="QUALIFIED_OPPORTUNITY">Oportunidade qualificada</option><option value="OTHER">Outro</option></select></label>
          <label className="admin-label">Data<input className="admin-input" type="date" name="occurredAt" defaultValue={today} required /></label><label className="admin-label">Empresa<input className="admin-input" name="company" maxLength={160} /></label><label className="admin-label">Cargo relacionado<input className="admin-input" name="roleTitle" maxLength={200} /></label><label className="admin-label">Mercado<input className="admin-input" name="market" placeholder="BR, US, EU…" /></label><label className="admin-label">Contato (opcional)<input className="admin-input" name="contactName" maxLength={160} /></label><label className="admin-label">Função do contato<input className="admin-input" name="contactRole" maxLength={160} /></label>
          <label className="admin-label">Origem<select className="admin-input" name="origin"><option value="UNKNOWN">Desconhecida</option><option value="POST_CONFIRMED">Publicação confirmada</option><option value="NETWORKING_CONFIRMED">Networking confirmado</option><option value="LINKEDIN_SEARCH">Busca no LinkedIn</option><option value="DIRECT_APPLICATION">Candidatura direta</option><option value="REFERRAL">Indicação</option><option value="OTHER">Outra</option></select></label><label className="admin-label">Associação não confirmada<select className="admin-input" name="association"><option value="UNLINKED">Sem vínculo</option><option value="HYPOTHESIS">Hipótese (não comprovada)</option></select></label>
          <label className="admin-label">Publicação (apenas publicada)<select className="admin-input" name="postId"><option value="">Sem associação</option>{data.publishedPosts.map((post) => <option key={post.id} value={post.id}>{post.title}</option>)}</select></label><label className="admin-label">Atividade de networking relacionada<select className="admin-input" name="networkingActivityId"><option value="">Sem associação</option>{data.networkingActivities.map((activity) => <option key={activity.id} value={activity.id}>{activity.type} · {new Date(activity.occurredAt).toLocaleDateString()}</option>)}</select></label>
          <label className="admin-label">Oportunidade já cadastrada<select className="admin-input" name="jobApplicationId"><option value="">Não vincular</option>{data.career.applications.map((application) => <option key={application.id} value={application.id}>{application.job.title} · {application.job.company ?? "empresa n/d"} · {application.status}</option>)}</select></label><label className="admin-label">Etapa<select className="admin-input" name="processStage"><option value="UNKNOWN">Não informada</option><option value="CONTACTED">Contato</option><option value="CONVERSATION">Conversa</option><option value="INTERVIEW">Entrevista</option><option value="OPPORTUNITY">Oportunidade</option><option value="OFFER">Oferta</option><option value="CLOSED">Encerrado</option></select></label>
          <label className="admin-label">Observação<textarea className="admin-input" name="observation" rows={2} /></label><label className="admin-label">Evidência da origem/associação<textarea className="admin-input" name="evidenceNote" rows={2} placeholder="Ex.: a recrutadora disse que encontrou o perfil pelo post X" /></label><button className="admin-button" disabled={busy}>Salvar resultado</button>
        </div></form>
        <div className="admin-panel"><h2>Networking observado</h2><div className="analytics-kpi-grid"><Kpi label="Atividades" value={data.networking.totalActivities} detail="no ciclo" /><Kpi label="Discussões revisadas" value={data.networking.discussionsReviewed} detail="registro manual" /><Kpi label="Comentários preparados" value={data.networking.commentsPrepared} detail="sem automação de publicação" /><Kpi label="Publicados confirmados" value={data.networking.manuallyConfirmedComments} detail="informados manualmente" /><Kpi label="Conexões relevantes" value={data.networking.relevantConnections} detail="registradas" /><Kpi label="Conversas iniciadas" value={data.networking.conversationsStarted} detail="registradas" /></div><p className="admin-subtitle">Tendências entre networking e alcance serão apresentadas como associações observacionais, nunca como causa comprovada.</p></div>
      </section>

      <section className="admin-panel"><div className="analytics-filter-row"><div><h2>Recomendações editoriais</h2><p className="admin-subtitle">Regras determinísticas com janela 7D, n explícito e sem mudança automática na pauta.</p></div></div>{data.recommendations.length ? <div className="experimentation-list">{data.recommendations.map((item) => <article className="experimentation-card" key={item.id}><div className="experimentation-card-head"><h3>{item.title}</h3><span className="status-chip">{item.status} · confiança {item.confidence}</span></div><p>{item.diagnosis}</p><p>{item.justification}</p><p><strong>Hipótese:</strong> {item.hypothesis}</p><p><strong>Próxima ação:</strong> {item.nextAction}</p><p><strong>Amostra:</strong> n={item.sampleSize}. Limitações: {Array.isArray(item.limitations) ? item.limitations.join(" ") : "descritas no snapshot"}</p><details><summary>Consultar dados e metodologia</summary><pre>{JSON.stringify(item.dataSnapshot, null, 2)}</pre></details>{item.status === "SUGGESTED" && <div className="analytics-filter-row"><button className="admin-button" type="button" disabled={busy} onClick={() => void decide(item.id, "APPROVED")}>Aprovar sugestão</button><button className="admin-button secondary" type="button" disabled={busy} onClick={() => void decide(item.id, "DEFERRED")}>Adiar</button><button className="admin-button danger" type="button" disabled={busy} onClick={() => void decide(item.id, "REJECTED")}>Rejeitar</button></div>}{item.status === "APPROVED" && <button className="admin-button secondary" type="button" disabled={busy} onClick={() => { const note = window.prompt("Descreva a ação editorial aplicada manualmente:"); if (note?.trim()) void decide(item.id, "APPLIED", note); }}>Registrar aplicação manual</button>}</article>)}</div> : <Empty>Sem recomendações com amostra mínima. Gere recomendações; o sistema manterá INSUFFICIENT_DATA sem inventar tendências.</Empty>}</section>

      <section className="admin-panel"><h2>Resultados de carreira registrados</h2>{data.outcomes.length ? <div className="experimentation-list">{data.outcomes.map((outcome) => <article className="experimentation-card compact" key={outcome.id}><div className="experimentation-card-head"><strong>{outcome.type.replaceAll("_", " ")}</strong><span className="status-chip">{outcome.origin} · {outcome.association}</span></div><p>{new Date(outcome.occurredAt).toLocaleDateString()} · {outcome.company ?? "empresa não informada"} · {outcome.roleTitle ?? "cargo não informado"} · etapa {label(outcome.processStage)}</p><p>{outcome.post ? `Post vinculado: ${outcome.post.title}` : "Sem post confirmado"}{outcome.networkingActivity ? ` · Atividade: ${outcome.networkingActivity.type}` : ""}{outcome.jobApplication ? ` · Oportunidade: ${outcome.jobApplication.job.title}` : ""}</p>{outcome.observation && <p>{outcome.observation}</p>}{outcome.evidenceNote && <p><strong>Base da associação:</strong> {outcome.evidenceNote}</p>}</article>)}</div> : <Empty>Nenhum contato ou resultado profissional registrado neste painel.</Empty>}</section>
      <p className="admin-subtitle">{data.limitations.join(" ")}</p>
    </>}
  </div>;
}

function Kpi({ label, value, detail }: { label: string; value: string | number; detail: string }) { return <article className="analytics-kpi"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="analytics-empty">{children}</p>; }
