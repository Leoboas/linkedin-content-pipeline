"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminNav } from "@/app/admin/AdminNav";
import { JobValidator } from "./JobValidator";
import { ResumeBuilder } from "./ResumeBuilder";
import { CareerPreferences } from "./CareerPreferences";

type CareerView = "jobs" | "resumes" | "profile" | "settings";
type Toast = { text: string; kind: "success" | "error" };
type Match = {
  id: string; title: string; company: string | null; location: string | null; url: string; description?: string;
  score: number; label: string; matchedSkills: string[]; skillGaps: string[]; rationale: string;
  eligibilityStatus?: string; eligibilityReasons?: string[]; sourceName?: string; sourceUrl?: string;
  recommendedResume?: string | null; recommendedResumeReason?: string | null; publishedAt?: string | null;
  scoreVersion?: string; scoreBreakdown?: Record<string, number>;
};
type Profile = { id: string; name: string; headline: string; about: string; location: string | null; linkedinUrl: string | null; skills: string[]; targetTitles: string[] };
export type CareerDashboardData = { profile: Profile | null; matches: Match[]; radar: Array<{ skill: string; category: string; demandCount: number; candidateLevel: number | null; gapScore: number }>; audit: { score: number; strengths: string[]; recommendations: string[]; createdAt: string } | null };
type SourceResult = { sourceKey: string; mode?: string; status: string; found: number; persisted?: number; error?: string };
type CareerScanRun = { id: string; inngestEventId?: string | null; status: "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL_SUCCESS" | "FAILED" | "CANCELLED"; queryCount: number; resultCount: number; savedCount?: number; discardedCount?: number; errorCount?: number; sourceResults?: SourceResult[] | null; errorMessage: string | null; startedAt: string; executionStartedAt?: string | null; completedAt: string | null };

const EMPTY_DATA: CareerDashboardData = { profile: null, matches: [], radar: [], audit: null };
const eligibilityLabels: Record<string, string> = {
  BRAZIL_ELIGIBLE: "Brasil indicado", LATAM_ELIGIBLE: "LATAM indicado", WORLDWIDE_ELIGIBLE: "Global indicado",
  RELOCATION_REQUIRED: "Relocation/visto a confirmar", REGION_RESTRICTED: "Restrita por região", UNKNOWN: "Países aceitos não informados",
};
const defaultSearchProfiles = ["Python Backend Engineer", "Data Engineer", "Software Engineer", "Software Architect", "Technical Lead hands-on"];

export function CareerDashboard({ initialData }: { initialData: CareerDashboardData }) {
  const [data, setData] = useState(initialData ?? EMPTY_DATA);
  const [token] = useState("session");
  const [view, setView] = useState<CareerView>("jobs");
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanRun, setScanRun] = useState<CareerScanRun | null>(null);
  const [query, setQuery] = useState("");
  const [eligibility, setEligibility] = useState("ALL");
  const [sort, setSort] = useState("match");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  const headers = useCallback((): HeadersInit => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` }), [token]);
  const notify = useCallback((text: string, kind: Toast["kind"] = "success") => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const [profileResponse, matchesResponse, applicationsResponse] = await Promise.all([
        fetch("/api/career/profile", { headers: headers(), cache: "no-store" }),
        fetch("/api/career/matches", { headers: headers(), cache: "no-store" }),
        fetch("/api/career/applications", { headers: headers(), cache: "no-store" }),
      ]);
      const [profilePayload, matchesPayload, applicationsPayload] = await Promise.all([profileResponse.json(), matchesResponse.json(), applicationsResponse.json()]);
      if (!profileResponse.ok || !matchesResponse.ok || !applicationsResponse.ok) throw new Error(profilePayload.error ?? matchesPayload.error ?? applicationsPayload.error ?? "Não foi possível carregar as oportunidades.");
      const matches: Match[] = (matchesPayload.matches ?? []).map((row: Record<string, unknown>) => {
        const job = row.job as Record<string, unknown>;
        const refs = (job.rawData as { sourceRefs?: Array<Record<string, unknown>> } | null)?.sourceRefs ?? [];
        const first = refs[0];
        const resume = row.recommendedResume as { originalName?: string } | null;
        return {
          id: String(job.id ?? row.id), title: String(job.title ?? "Cargo não informado"), company: typeof job.company === "string" ? job.company : null,
          location: typeof job.location === "string" ? job.location : null, url: String(job.url ?? ""), description: typeof job.description === "string" ? job.description : "",
          score: Number(row.score ?? 0), label: String(row.label ?? "Match calculado"),
          matchedSkills: Array.isArray(row.matchedSkills) ? row.matchedSkills as string[] : [], skillGaps: Array.isArray(row.skillGaps) ? row.skillGaps as string[] : [],
          rationale: String(row.rationale ?? "Compatibilidade calculada com os dados disponíveis."), eligibilityStatus: String(row.eligibilityStatus ?? "UNKNOWN"),
          eligibilityReasons: Array.isArray(row.eligibilityReasons) ? row.eligibilityReasons as string[] : [], sourceName: typeof first?.attributionName === "string" ? first.attributionName : "Fonte pública",
          sourceUrl: typeof first?.attributionUrl === "string" ? first.attributionUrl : String(job.url ?? ""), recommendedResume: resume?.originalName ?? null,
          recommendedResumeReason: typeof row.recommendedResumeReason === "string" ? row.recommendedResumeReason : null,
          scoreVersion: typeof row.scoreVersion === "string" ? row.scoreVersion : undefined,
          scoreBreakdown: row.scoreBreakdown && typeof row.scoreBreakdown === "object" ? row.scoreBreakdown as Record<string, number> : undefined,
          publishedAt: job.sourcePublishedAt instanceof Date ? job.sourcePublishedAt.toISOString() : typeof job.sourcePublishedAt === "string" ? job.sourcePublishedAt : null,
        };
      });
      const profile = profilePayload ? {
        id: String(profilePayload.id), name: String(profilePayload.name), headline: String(profilePayload.headline), about: String(profilePayload.about),
        location: typeof profilePayload.location === "string" ? profilePayload.location : null, linkedinUrl: typeof profilePayload.linkedinUrl === "string" ? profilePayload.linkedinUrl : null,
        skills: Array.isArray(profilePayload.skills) ? profilePayload.skills : [], targetTitles: Array.isArray(profilePayload.targetTitles) ? profilePayload.targetTitles : [],
      } satisfies Profile : null;
      setData((current) => ({ ...current, profile, matches, radar: matchesPayload.radar ?? [], audit: current.audit }));
      setSavedIds((applicationsPayload.applications ?? []).flatMap((item: { job?: { id?: string } }) => item.job?.id ? [item.job.id] : []));
      if (!quiet) notify("Oportunidades e perfil atualizados.");
    } catch (error) { if (!quiet) notify(error instanceof Error ? error.message : "Falha ao carregar oportunidades.", "error"); }
    finally { if (!quiet) setBusy(false); }
  }, [headers, notify]);

  const loadRun = useCallback(async (runId?: string) => {
    const url = runId ? `/api/career/scan?runId=${encodeURIComponent(runId)}` : "/api/career/scan";
    const response = await fetch(url, { headers: headers(), cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { run?: CareerScanRun | null };
    if (payload.run) { setScanRun(payload.run); setScanning(["QUEUED", "RUNNING"].includes(payload.run.status)); }
  }, [headers]);

  useEffect(() => {
    void loadDashboard(true);
    void loadRun();
  }, [loadDashboard, loadRun]);

  useEffect(() => {
    if (!scanRun || !["QUEUED", "RUNNING"].includes(scanRun.status)) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/career/scan?runId=${encodeURIComponent(scanRun.id)}`, { headers: headers(), cache: "no-store" });
        if (!response.ok) return;
        const current = (await response.json() as { run?: CareerScanRun }).run;
        if (!active || !current) return;
        setScanRun(current);
        if (!["QUEUED", "RUNNING"].includes(current.status)) {
          setScanning(false);
          if (["COMPLETED", "PARTIAL_SUCCESS"].includes(current.status)) await loadDashboard(true);
          const saved = current.savedCount ?? 0;
          const detail = current.status === "FAILED" ? current.errorMessage ?? "As fontes falharam." : current.status === "PARTIAL_SUCCESS" ? `Busca parcial: ${saved} vagas persistidas.` : current.status === "COMPLETED" ? `Busca concluída: ${saved} vagas persistidas.` : `Busca ${current.status.toLocaleLowerCase("pt-BR")}.`;
          notify(detail, current.status === "COMPLETED" || current.status === "PARTIAL_SUCCESS" ? "success" : "error");
        }
      } catch { /* polling seguinte recupera erros transitórios */ }
    };
    const timer = window.setInterval(() => void poll(), 5000);
    void poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [scanRun?.id, scanRun?.status, headers, loadDashboard, notify]);

  const scan = async () => {
    setBusy(true); setScanning(true);
    try {
      const response = await fetch("/api/career/scan", { method: "POST", headers: headers() });
      const payload = await response.json() as { error?: string; run?: CareerScanRun };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? "A busca não foi enfileirada.");
      setScanRun(payload.run); notify(payload.run.status === "RUNNING" ? "Busca já em execução; acompanhando o mesmo run." : "Busca enfileirada. O catálogo continuará disponível enquanto atualiza.");
    } catch (error) { setScanning(false); notify(error instanceof Error ? error.message : "Falha ao iniciar a busca.", "error"); }
    finally { setBusy(false); }
  };

  const saveJob = async (jobId: string) => {
    setSavingId(jobId);
    try {
      const response = await fetch("/api/career/applications", { method: "POST", headers: headers(), body: JSON.stringify({ jobId }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível salvar a vaga.");
      setSavedIds((current) => current.includes(jobId) ? current : [...current, jobId]); notify("Vaga salva no pipeline de candidaturas.");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao salvar a vaga.", "error"); }
    finally { setSavingId(null); }
  };

  const audit = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/career/seo", { method: "POST", headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível auditar o perfil.");
      setData((current) => ({ ...current, audit: payload })); notify("Auditoria de perfil atualizada.");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha na auditoria.", "error"); }
    finally { setBusy(false); }
  };

  const saveProfile = async (form: HTMLFormElement) => {
    const values = new FormData(form);
    const payload = {
      name: String(values.get("name") ?? ""), headline: String(values.get("headline") ?? ""), about: String(values.get("about") ?? ""),
      location: String(values.get("location") ?? ""), linkedinUrl: String(values.get("linkedinUrl") ?? ""),
      skills: String(values.get("skills") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      targetTitles: String(values.get("targetTitles") ?? "").split(/\n|,/).map((item) => item.trim()).filter(Boolean),
    };
    setBusy(true);
    try {
      const response = await fetch("/api/career/profile", { method: "PUT", headers: headers(), body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar o perfil.");
      notify("Alterações revisadas e salvas."); await loadDashboard(true);
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao salvar o perfil.", "error"); }
    finally { setBusy(false); }
  };

  const filteredMatches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    const result = data.matches.filter((job) => {
      const text = `${job.title} ${job.company ?? ""} ${job.location ?? ""} ${job.description ?? ""}`.toLocaleLowerCase("pt-BR");
      return (!q || text.includes(q)) && (eligibility === "ALL" || job.eligibilityStatus === eligibility);
    });
    return result.sort((left, right) => sort === "recent" ? Date.parse(right.publishedAt ?? "") - Date.parse(left.publishedAt ?? "") || right.score - left.score : sort === "company" ? (left.company ?? "").localeCompare(right.company ?? "") : sort === "eligible" ? Number(right.eligibilityStatus?.endsWith("ELIGIBLE")) - Number(left.eligibilityStatus?.endsWith("ELIGIBLE")) || right.score - left.score : right.score - left.score);
  }, [data.matches, eligibility, query, sort]);
  const selected = filteredMatches.find((job) => job.id === selectedId) ?? null;
  const eligibleCount = data.matches.filter((job) => job.eligibilityStatus?.endsWith("ELIGIBLE")).length;
  const eligibleBadge = (status?: string) => <span className={`career-eligibility ${status?.endsWith("ELIGIBLE") ? "positive" : status === "REGION_RESTRICTED" || status === "RELOCATION_REQUIRED" ? "warning" : "unknown"}`}>{eligibilityLabels[status ?? "UNKNOWN"] ?? "Elegibilidade a confirmar"}</span>;

  return <main className="admin-shell"><div className="admin-container career-container"><AdminNav current="career" />
    {toast && <div className={`admin-toast ${toast.kind}`} role="status">{toast.text}</div>}
    <header className="career-header"><div><div className="admin-kicker">CAREER INTELLIGENCE</div><h1>Oportunidades para você</h1><p>Descoberta em fontes autorizadas, compatibilidade técnica e elegibilidade geográfica separadas.</p></div><button className="admin-button active" onClick={() => void scan()} disabled={busy || scanning}>{scanning ? scanRun?.status === "QUEUED" ? "Na fila…" : "Buscando…" : "↻ Atualizar vagas"}</button></header>
    <nav className="career-tabs" aria-label="Career Intelligence">{([["jobs", "Job Search"], ["applications", "Applications"], ["resumes", "Resume Library"], ["profile", "Career Profile"], ["settings", "Search Settings"]] as const).map(([key, label]) => key === "applications" ? <a className="career-tab-link" href="/career/applications" key={key}>{label}</a> : <button type="button" key={key} className={`career-tab ${view === key ? "active" : ""}`} onClick={() => setView(key)}>{label}</button>)}</nav>
    {view === "jobs" && <>
      <section className="career-summary"><div><span>Oportunidades persistidas</span><strong>{data.matches.length}</strong></div><div><span>Elegibilidade indicada</span><strong>{eligibleCount}</strong></div><div><span>Perfis de busca</span><strong>{(data.profile?.targetTitles.length || defaultSearchProfiles.length)}</strong></div></section>
      <section className="career-search-toolbar"><label className="career-search-input"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cargo, empresa ou tecnologia" aria-label="Buscar por cargo, empresa ou tecnologia" /></label><label>Ordenar<select className="admin-input" value={sort} onChange={(event) => setSort(event.target.value)}><option value="match">Best Match</option><option value="recent">Mais recentes</option><option value="eligible">Elegibilidade</option><option value="company">Empresa</option></select></label><label>Elegibilidade<select className="admin-input" value={eligibility} onChange={(event) => setEligibility(event.target.value)}><option value="ALL">Todas</option><option value="BRAZIL_ELIGIBLE">Brasil indicado</option><option value="LATAM_ELIGIBLE">LATAM indicado</option><option value="WORLDWIDE_ELIGIBLE">Global indicado</option><option value="UNKNOWN">A confirmar</option><option value="REGION_RESTRICTED">Restrita</option></select></label></section>
      <div className="career-profile-chips">{(data.profile?.targetTitles.length ? data.profile.targetTitles : defaultSearchProfiles).map((item) => <span key={item}>{item}</span>)}</div>
      <section className="career-results-heading"><div><h2>Recommended Jobs <span>{filteredMatches.length}</span></h2><p>Match Score prioriza aderência; não estima chance de contratação.</p></div><div className="career-last-sync" role="status">{scanRun?.status === "QUEUED" ? `Na fila desde ${new Date(scanRun.startedAt).toLocaleString("pt-BR")} · evento ${scanRun.inngestEventId?.slice(0, 8) ?? scanRun.id.slice(0, 8)}` : scanRun?.status === "RUNNING" ? `Busca em andamento desde ${new Date(scanRun.executionStartedAt ?? scanRun.startedAt).toLocaleString("pt-BR")}` : scanRun?.completedAt ? `Atualizado ${new Date(scanRun.completedAt).toLocaleString("pt-BR")}` : "Catálogo persistido"}</div></section>
      {scanRun?.sourceResults && <details className="career-source-health"><summary>Detalhes da última sincronização · {scanRun.savedCount ?? 0} vagas persistidas</summary><div>{scanRun.sourceResults.map((source) => <span key={source.sourceKey}>{source.sourceKey}: {source.status} · {source.persisted ?? 0} salvas{source.error ? ` · ${source.error}` : ""}</span>)}</div></details>}
      <div className="career-catalog-layout"><section className="career-job-grid" aria-label="Oportunidades recomendadas">{filteredMatches.length ? filteredMatches.map((job) => <button type="button" key={job.id} className={`career-job-card ${selectedId === job.id ? "selected" : ""}`} onClick={() => setSelectedId(job.id)} aria-pressed={selectedId === job.id}>
        <div className="career-job-card-head"><span className="career-score">{Math.round(job.score)}<small>/100</small></span><div><h3>{job.title}</h3><p>{job.company ?? "Empresa não informada"}</p></div><span className="career-card-chevron">↗</span></div><p className="career-job-location">{job.location ?? "Localização não informada"}</p><div className="career-job-badges">{eligibleBadge(job.eligibilityStatus)}<span>{job.sourceName ?? "Fonte pública"}</span></div><p className="career-job-rationale">{job.rationale}</p><div className="career-skill-chips">{job.matchedSkills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}{!job.matchedSkills.length && <span>Compatibilidade baseada na descrição disponível</span>}</div>
      </button>) : <div className="career-empty"><span>◎</span><h2>{data.matches.length ? "Nenhuma vaga corresponde aos filtros" : "Sua busca começa aqui"}</h2><p>{data.matches.length ? "Ajuste os termos ou os filtros de elegibilidade." : "Inicie uma busca nas fontes disponíveis. As oportunidades persistidas aparecerão aqui, sem precisar colar URLs."}</p>{data.matches.length === 0 && <button className="admin-button active" onClick={() => void scan()} disabled={busy || scanning}>{scanning ? "Busca em andamento…" : "Descobrir vagas"}</button>}</div>}</section>
      <aside className="career-detail" aria-label="Detalhes da vaga">{selected ? <>
        <div className="career-detail-top"><div><div className="admin-kicker">DETALHES DA OPORTUNIDADE</div><h2>{selected.title}</h2><p>{selected.company ?? "Empresa não informada"} · {selected.location ?? "Localização não informada"}</p></div><button className="career-close" aria-label="Fechar detalhes" onClick={() => setSelectedId(null)}>×</button></div>
        <div className="career-score-breakdown"><strong>{Math.round(selected.score)}<small>/100</small></strong><div><b>Compatibilidade técnica</b><span>Não é probabilidade de contratação</span></div></div>
        <section><h3>Elegibilidade geográfica</h3>{eligibleBadge(selected.eligibilityStatus)}{selected.eligibilityReasons?.map((reason) => <p className="career-detail-copy" key={reason}>{reason}</p>)}</section>
        <section><h3>Requisitos correspondentes</h3><div className="career-detail-skills">{selected.matchedSkills.length ? selected.matchedSkills.map((skill) => <span className="match" key={skill}>{skill}</span>) : <p>Sem requisitos confirmados na descrição recebida.</p>}</div></section>
        <section><h3>Gaps / não comprovados</h3><div className="career-detail-skills">{selected.skillGaps.length ? selected.skillGaps.map((skill) => <span className="gap" key={skill}>{skill}</span>) : <p>Nenhum gap identificado pelo comparador disponível.</p>}</div></section>
        {selected.scoreBreakdown && <section><h3>Composição do score · {selected.scoreVersion ?? "versão não registrada"}</h3><div className="career-score-dimensions">{Object.entries(selected.scoreBreakdown).filter(([key]) => key !== "evidenceConfidence").map(([key, value]) => <div key={key}><span>{key === "technicalSkills" ? "Competências técnicas" : key === "roleAlignment" ? "Família de cargo" : key === "responsibilityEvidence" ? "Responsabilidades" : key === "seniorityAlignment" ? "Senioridade" : key}</span><strong>{value}</strong></div>)}</div><small>Indicadores calculados deterministicamente a partir dos dados disponíveis; localização é apresentada em elegibilidade separada.</small></section>}
        <section><h3>Currículo recomendado</h3><p className="career-detail-copy">{selected.recommendedResume ?? "Documento autorizado correspondente ainda não foi importado; envio permanece indisponível."}</p>{selected.recommendedResumeReason && <small>{selected.recommendedResumeReason}</small>}</section>
        <details className="career-description"><summary>Descrição original</summary><div>{selected.description || "A fonte não forneceu a descrição completa."}</div></details>
        <div className="career-detail-actions"><button className="admin-button active" disabled={savedIds.includes(selected.id) || savingId === selected.id} onClick={() => void saveJob(selected.id)}>{savedIds.includes(selected.id) ? "✓ Salva" : savingId === selected.id ? "Salvando…" : "Salvar vaga"}</button><a className="admin-button" href={selected.url} target="_blank" rel="noreferrer">Abrir candidatura oficial ↗</a><a className="career-attribution" href={selected.sourceUrl ?? selected.url} target="_blank" rel="noreferrer">Fonte: {selected.sourceName ?? "fonte original"}</a></div>
      </> : <div className="career-detail-empty"><span>↖</span><h2>Selecione uma vaga</h2><p>O detalhamento, score, evidências e currículo recomendado aparecem aqui.</p></div>}</aside></div>
    </>}
    {view === "resumes" && <><ResumeBuilder token={token} matches={data.matches} /><JobValidator token={token} onValidated={() => void loadDashboard(true)} /></>}
    {view === "settings" && <CareerPreferences token={token} />}
    {view === "profile" && <>
      <section className="admin-panel"><div className="admin-kicker">PERFIL PROFISSIONAL</div><h2>{data.profile?.name ?? "Perfil profissional"}</h2><p className="career-profile-headline">{data.profile?.headline ?? "Importe um perfil autorizado para personalizar as recomendações."}</p>{data.profile && <><p>{data.profile.about}</p><p><strong>Competências</strong><br />{data.profile.skills.join(" · ") || "Não informadas"}</p><p><strong>Cargos de busca</strong><br />{data.profile.targetTitles.join(" · ") || "Serão usados os perfis de engenharia padrão"}</p></>}</section>
      <details className="admin-panel"><summary>Revisar e corrigir dados do perfil</summary><form className="admin-edit" onSubmit={(event) => { event.preventDefault(); void saveProfile(event.currentTarget); }}><input className="admin-input" name="name" required placeholder="Nome" defaultValue={data.profile?.name ?? ""} /><input className="admin-input" name="headline" required placeholder="Headline profissional" defaultValue={data.profile?.headline ?? ""} /><textarea className="admin-textarea" name="about" required placeholder="Resumo profissional" defaultValue={data.profile?.about ?? ""} /><input className="admin-input" name="location" placeholder="País de residência" defaultValue={data.profile?.location ?? ""} /><input className="admin-input" name="linkedinUrl" type="url" placeholder="URL do LinkedIn" defaultValue={data.profile?.linkedinUrl ?? ""} /><input className="admin-input" name="skills" placeholder="Competências separadas por vírgula" defaultValue={data.profile?.skills.join(", ") ?? ""} /><textarea className="admin-textarea" name="targetTitles" placeholder="Cargos-alvo de engenharia (um por linha)" defaultValue={data.profile?.targetTitles.join("\n") ?? ""} /><button className="admin-button active" type="submit" disabled={busy}>Salvar alterações revisadas</button></form></details>
      <section className="admin-panel"><div className="admin-kicker">SKILL RADAR</div><h2>Competências observadas nas vagas</h2><div className="career-skill-radar">{data.radar.slice(0, 12).map((skill) => <article className="admin-card" key={`${skill.category}-${skill.skill}`}><strong>{skill.skill}</strong><span className="admin-meta">Demanda {skill.demandCount} · gap {Math.round(skill.gapScore)}/100</span></article>)}</div></section>
      <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">LINKEDIN SEO</div><h2>Auditoria do perfil</h2></div><button className="admin-button" disabled={busy} onClick={() => void audit()}>Executar auditoria</button></div>{data.audit ? <><strong>Nota: {Math.round(data.audit.score)}/100</strong><p>{data.audit.strengths.join(" · ")}</p><ul>{data.audit.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}</ul></> : <p>A auditoria fica nesta área de perfil, fora do catálogo de vagas.</p>}</section>
    </>}
    <footer className="career-privacy-note">Fontes públicas e integrações autorizadas. Match Score é uma ferramenta de priorização, não uma previsão de contratação. Nenhuma candidatura é enviada automaticamente.</footer>
  </div></main>;
}
