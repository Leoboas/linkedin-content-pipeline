"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type MetricPost = { id: string; title: string; publishedAt: string; linkedinPostId: string | null; language: string; formatType: string };
type DashboardData = {
  automaticCollection: { status: "DISABLED" | "UNAVAILABLE" | "ACTIVE"; reason: string | null };
  period: { from: string; to: string; window: string };
  overview: {
    publishedPosts: number; postsWithSnapshot: number;
    impressions: { value: number | null; measuredPosts: number };
    averageImpressionsPerPost: number | null; medianImpressionsPerPost: number | null;
    membersReached: { total: null; meanPerPost: number | null; medianPerPost: number | null; measuredPosts: number; note: string };
    reactions: { value: number | null; measuredPosts: number }; comments: { value: number | null; measuredPosts: number };
    reposts: { value: number | null; measuredPosts: number }; saves: { value: number | null; measuredPosts: number };
    sends: { value: number | null; measuredPosts: number }; linkClicks: { value: number | null; measuredPosts: number };
    profileViewsFromPosts: { value: number | null; measuredPosts: number }; followersGainedFromPosts: { value: number | null; measuredPosts: number };
    outOfNetworkPercent: number | null; outOfNetworkImpressions: { value: number | null; measuredPosts: number };
    outOfNetworkPercentMethod: string; averageCareerRelevanceScore: number | null; averageHookQualityScore: number | null;
  };
  rankings: Record<string, Array<{ postId: string; title: string; language: string; publishedAt: string; value: number; window: string; exposureHours: number | null; source: string; capturedAt: string }>>;
  comparisons: Array<{ window: string; dimension: string; value: string; sampleSize: number; measuredRateSample: number; meanInteractionRate: number | null; medianInteractionRate: number | null; meanImpressions: number | null; medianImpressions: number | null; meanMembersReached: number | null; medianMembersReached: number | null; meanSaves: number | null; meanProfileViewsAttributed: number | null }>;
  windowEvolution: Array<{ window: string; sampleSize: number; medianImpressions: number | null; medianMembersReached: number | null; medianExposureHours: number | null }>;
  audience: Record<string, { status: string; sampleSize: number; distribution: Array<{ label: string; count: number }>; note: string }>;
  aggregateImports: Array<{ id: string; fileName: string; sourceLabel: string; status: string; rowsSeen: number; rowsImported: number; rowsUnmatched: number; errors: unknown; aggregateRows: unknown; capturedAt: string }>;
  posts: Array<{ id: string; title: string; language: string; publishedAt: string; formatType: string; visualFormat: string | null; pillar: string; objective: string | null; topic: string | null; careerRelevanceScore: number | null; hookQualityScore: number | null; evidence: unknown; snapshot: Record<string, unknown> | null; snapshots: Array<{ window: string; capturedAt: string; exposureHours: number | null; latenessHours: number | null; source: string; availability: string; impressions: number | null; membersReached: number | null; outOfNetworkPercent: number | null }> }>;
  limitations: string[];
};
type Preview = { fileName: string; headers: string[]; suggestedMapping: Record<string, string>; mappingFields: string[]; rows: Array<{ rowNumber: number; values: Record<string, string> }>; posts: MetricPost[]; totalRows: number };

const mappingLabels: Record<string, string> = {
  linkedinPostId: "LinkedIn Post ID / URN", postUrl: "URL da publicação", title: "Título", publishedAt: "Data de publicação", capturedAt: "Data do relatório",
  impressions: "Impressões", membersReached: "Pessoas alcançadas", impressionsInNetwork: "Impressões dentro da rede", impressionsOutOfNetwork: "Impressões fora da rede",
  inNetworkPercent: "% dentro da rede", outOfNetworkPercent: "% fora da rede", reactions: "Reações", comments: "Comentários", shares: "Reposts/compartilhamentos",
  postSaves: "Salvamentos", postSends: "Envios", linkClicks: "Cliques no link", followersGained: "Seguidores ganhos", profileViewsFromContent: "Visitas ao perfil pelo post",
  measurementWindow: "Janela de medição", audienceCountry: "País/região da audiência", audienceRole: "Cargo da audiência", audienceSeniority: "Senioridade", audienceIndustry: "Setor",
};
const numericMetrics = ["impressions", "membersReached", "impressionsInNetwork", "impressionsOutOfNetwork", "inNetworkPercent", "outOfNetworkPercent", "reactions", "comments", "shares", "postSaves", "postSends", "linkClicks", "followersGained", "profileViewsFromContent"] as const;
const displayMetrics = [
  ["impressions", "Impressões"], ["membersReached", "Alcance médio por post"], ["outOfNetworkImpressions", "Impressões fora da rede"],
  ["outOfNetworkPercent", "% fora da rede"], ["reactions", "Reações"], ["comments", "Comentários"], ["reposts", "Reposts"],
  ["saves", "Salvamentos"], ["sends", "Envios"], ["linkClicks", "Cliques"], ["profileViewsFromPosts", "Visitas ao perfil pelos posts"],
  ["followersGainedFromPosts", "Seguidores atribuídos aos posts"],
] as const;
const defaultRange = () => {
  const today = new Date();
  const from = new Date(today.getTime() - 90 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
};
const fmt = (value: number | null | undefined, suffix = "") => value === null || value === undefined ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}${suffix}`;

export function PerformanceDashboard() {
  const [range, setRange] = useState(defaultRange);
  const [preset, setPreset] = useState("90");
  const [window, setWindow] = useState("7D");
  const [report, setReport] = useState<DashboardData | null>(null);
  const [posts, setPosts] = useState<MetricPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [associations, setAssociations] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [manualPost, setManualPost] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, window });
      const response = await fetch(`/api/admin/insights?${params}`, { cache: "no-store" });
      const data = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `Falha HTTP ${response.status}`);
      setReport(data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível carregar o Analytics."); }
    finally { setLoading(false); }
  }, [range.from, range.to, window]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    void fetch("/api/admin/analytics/import", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { posts?: MetricPost[] };
      setPosts(data.posts ?? []);
      if (!manualPost && data.posts?.[0]) setManualPost(data.posts[0].id);
    });
  // Initial candidate load only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPresetRange = (days: string) => {
    setPreset(days);
    if (days === "custom") return;
    const to = new Date();
    const from = new Date(to.getTime() - Number(days) * 86_400_000);
    setRange({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
  };

  async function previewFile() {
    if (!file) { setError("Escolha um arquivo CSV ou XLSX."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const data = new FormData(); data.set("file", file); data.set("mode", "preview");
      const response = await fetch("/api/admin/analytics/import", { method: "POST", body: data });
      const result = await response.json() as Preview & { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Falha HTTP ${response.status}`);
      setPreview(result); setMapping(result.suggestedMapping); setAssociations({});
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao pré-visualizar arquivo."); }
    finally { setBusy(false); }
  }

  async function importFile() {
    if (!file || !preview) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = new FormData(); data.set("file", file); data.set("mode", "import"); data.set("mapping", JSON.stringify(mapping)); data.set("associations", JSON.stringify(associations));
      data.set("sourceLabel", "LinkedIn Analytics export importado pelo Dashboard"); data.set("measurementWindow", window);
      const response = await fetch("/api/admin/analytics/import", { method: "POST", body: data });
      const result = await response.json() as { error?: string; alreadyImported?: boolean; reimported?: boolean; rowsImported?: number; rowsUnmatched?: number; errors?: Array<{ rowNumber: number; reason: string }> };
      if (!response.ok) throw new Error(result.error ?? `Falha HTTP ${response.status}`);
      setNotice(`${result.reimported ? "Mapeamento do arquivo atualizado sem duplicar snapshots." : "Importação registrada."} ${result.rowsImported ?? 0} posts associados; ${result.rowsUnmatched ?? 0} linhas mantidas separadas como agregadas/não associadas.${result.errors?.length ? ` ${result.errors.length} linha(s) com erro.` : ""}`);
      setPreview(null); setFile(null); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao importar arquivo."); }
    finally { setBusy(false); }
  }

  async function saveManual(form: HTMLFormElement) {
    const data = new FormData(form);
    const values = Object.fromEntries(numericMetrics.map((field) => [field, String(data.get(field) ?? "").trim() || null]));
    if (Object.values(values).every((value) => value === null)) { setError("Preencha ao menos uma métrica observada."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/posts/${manualPost}/metrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, measurementWindow: data.get("measurementWindow"), capturedAt: data.get("capturedAt"), sourceNote: data.get("sourceNote") }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Falha HTTP ${response.status}`);
      form.reset(); setNotice("Snapshot manual salvo com data, janela e origem."); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao salvar snapshot manual."); }
    finally { setBusy(false); }
  }

  const topChart = useMemo(() => report?.rankings.impressions.slice(0, 8) ?? [], [report]);
  const maxImpressions = Math.max(1, ...topChart.map((entry) => entry.value));
  const postLabels = new Map(posts.map((post) => [post.id, post]));

  return <div className="analytics-workspace">
    <section className="admin-panel analytics-controls">
      <div><h2>Performance editorial</h2><p className="admin-subtitle">Dados observados por publicação e janela de exposição. Impressões entre posts não representam pessoas únicas.</p></div>
      <div className="analytics-filter-row">
        <label className="admin-label">Período<select className="admin-input" value={preset} onChange={(event) => setPresetRange(event.target.value)}><option value="7">Últimos 7 dias</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option><option value="custom">Personalizado</option></select></label>
        <label className="admin-label">Janela<select className="admin-input" value={window} onChange={(event) => setWindow(event.target.value)}><option value="24H">D+1 (24h+)</option><option value="72H">D+3 (72h+)</option><option value="7D">D+7 (168h+)</option><option value="LIFETIME">Acumulado/manual</option><option value="BEST_AVAILABLE">Maior janela disponível</option></select></label>
        {preset === "custom" && <><label className="admin-label">De<input className="admin-input" type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} /></label><label className="admin-label">Até<input className="admin-input" type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} /></label></>}
        <button className="admin-button" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Atualizando…" : "Atualizar"}</button>
      </div>
    </section>
    {error && <p role="alert" className="analytics-notice error">{error}</p>}{notice && <p role="status" className="analytics-notice">{notice}</p>}
    {report && <>
      <section className={`analytics-collection-status ${report.automaticCollection.status.toLowerCase()}`}><strong>Coleta automática: {report.automaticCollection.status}</strong><span>{report.automaticCollection.status === "ACTIVE" ? "Cron, orçamento e permissão estão configurados." : `A coleta por API não está ativa (${report.automaticCollection.reason ?? "motivo não informado"}). Importação CSV/XLSX e entrada manual continuam disponíveis.`}</span></section>
      <section className="analytics-kpi-grid" aria-label="Resumo de performance">
        <Kpi label="Publicações" value={fmt(report.overview.publishedPosts)} detail={`${report.overview.postsWithSnapshot} com snapshot na janela`} />
        <Kpi label="Impressões" value={fmt(report.overview.impressions.value)} detail={`média ${fmt(report.overview.averageImpressionsPerPost)} · mediana ${fmt(report.overview.medianImpressionsPerPost)} por post`} />
        <Kpi label="Pessoas alcançadas" value={fmt(report.overview.membersReached.meanPerPost)} detail={`média por post · mediana ${fmt(report.overview.membersReached.medianPerPost)}; não somadas`} />
        <Kpi label="Descoberta fora da rede" value={fmt(report.overview.outOfNetworkPercent, "%")} detail={`${fmt(report.overview.outOfNetworkImpressions.value)} impressões absolutas · ${report.overview.outOfNetworkPercentMethod}`} />
        <Kpi label="Visitas ao perfil" value={fmt(report.overview.profileViewsFromPosts.value)} detail={`${report.overview.profileViewsFromPosts.measuredPosts} posts com atribuição observada`} />
        <Kpi label="Seguidores atribuídos" value={fmt(report.overview.followersGainedFromPosts.value)} detail={`${report.overview.followersGainedFromPosts.measuredPosts} posts com valor informado`} />
        <Kpi label="Engajamento" value={`${fmt(report.overview.reactions.value)} reações`} detail={`${fmt(report.overview.comments.value)} comentários · ${fmt(report.overview.reposts.value)} reposts · ${fmt(report.overview.saves.value)} saves`} />
        <Kpi label="Aderência editorial média" value={fmt(report.overview.averageCareerRelevanceScore, "/5")} detail={`gancho médio ${fmt(report.overview.averageHookQualityScore, "/100")}`} />
      </section>
      <section className="analytics-two-column">
        <div className="admin-panel"><h2>Posts com mais impressões</h2><p className="admin-subtitle">Janela selecionada; exposição real preservada.</p>{topChart.length ? <div className="analytics-bars">{topChart.map((item) => <div className="analytics-bar-row" key={item.postId}><div className="analytics-bar-label"><span>{item.title}</span><strong>{fmt(item.value)}</strong></div><div className="analytics-bar-track"><i style={{ width: `${Math.max(2, item.value / maxImpressions * 100)}%` }} /></div><small>{item.language} · {item.window} · {fmt(item.exposureHours)}h · {item.source}</small></div>)}</div> : <Empty>No momento não há impressões observadas nessa janela e período.</Empty>}</div>
        <div className="admin-panel"><h2>Distribuição da audiência</h2><p className="admin-subtitle">Apenas categorias explicitamente importadas; sem inferência de identidade.</p>{Object.entries(report.audience).map(([key, value]) => <div className="analytics-audience" key={key}><strong>{mappingLabels[key] ?? key}</strong><span>{value.status === "INSUFFICIENT_DATA" ? "INSUFFICIENT_DATA" : value.distribution.map((entry) => `${entry.label} (${entry.count})`).join(" · ")}</span></div>)}</div>
      </section>
      <section className="admin-panel"><h2>Evolução por idade da publicação</h2><p className="admin-subtitle">Medianas de snapshots cumulativos D+1/D+3/D+7; cada janela usa os posts observados e mostra seu próprio n. Não é alcance único.</p>{report.windowEvolution.some((entry) => entry.sampleSize >= 3) ? <div className="analytics-comparison-grid">{report.windowEvolution.map((entry) => <article key={entry.window}><strong>{entry.window} · n={entry.sampleSize}</strong><span>mediana de impressões {fmt(entry.medianImpressions)}</span><span>mediana de alcance por post {fmt(entry.medianMembersReached)}</span><span>exposição mediana {fmt(entry.medianExposureHours)}h</span></article>)}</div> : <Empty>Amostra insuficiente para tendência entre janelas. Quando houver snapshots, os valores aparecerão com a amostra por marco.</Empty>}</section>
      <section className="admin-panel"><h2>Comparações descritivas</h2><p className="admin-subtitle">Médias e medianas por post, separadas pela janela escolhida. Grupos com poucas publicações não são tratados como vencedores.</p>{report.comparisons.length ? <div className="analytics-comparison-grid">{report.comparisons.map((group) => <article key={`${group.window}:${group.dimension}:${group.value}`}><strong>{group.dimension}: {group.value}</strong><span>n={group.sampleSize} · janela {group.window}</span><span>impressões média/mediana {fmt(group.meanImpressions)} / {fmt(group.medianImpressions)}</span><span>alcance médio/mediano {fmt(group.meanMembersReached)} / {fmt(group.medianMembersReached)} por post</span><span>taxa de interação média/mediana {fmt(group.meanInteractionRate, "%")} / {fmt(group.medianInteractionRate, "%")}</span><span>saves {fmt(group.meanSaves)} · visitas atribuídas {fmt(group.meanProfileViewsAttributed)}</span>{group.sampleSize < 3 && <small>Amostra insuficiente para hipótese comparativa.</small>}</article>)}</div> : <Empty>Dados comparáveis insuficientes. Importe snapshots da mesma janela.</Empty>}</section>
      <section className="admin-panel"><h2>Desempenho por publicação</h2>{report.posts.length ? <div className="analytics-post-list">{report.posts.map((post) => <article key={post.id}><header><strong>{post.title}</strong><span>{post.language} · {post.pillar} · {post.objective ?? "objetivo não informado"} · publicado {new Date(post.publishedAt).toLocaleString("pt-BR")}</span></header><div className="analytics-post-tags"><span>{post.formatType}{post.visualFormat ? ` / ${post.visualFormat}` : ""}</span><span>{post.topic ?? "tema não classificado"}</span><span>Career {fmt(post.careerRelevanceScore, "/5")}</span><span>Hook {fmt(post.hookQualityScore, "/100")}</span></div>{post.snapshot ? <><p>Janela selecionada: {String(post.snapshot.window)} · exposição real {fmt(post.snapshot.exposureHours as number | null)}h · atraso após janela {fmt(post.snapshot.latenessHours as number | null)}h · {String(post.snapshot.source)} · {String(post.snapshot.availability)} · coletado {new Date(String(post.snapshot.capturedAt)).toLocaleString("pt-BR")}</p><p>Impressões {fmt(post.snapshot.impressions as number | null)} · alcance {fmt(post.snapshot.membersReached as number | null)} · fora da rede {fmt(post.snapshot.impressionsOutOfNetwork as number | null)} ({fmt(post.snapshot.outOfNetworkPercent as number | null, "%")})</p><p>Reações {fmt(post.snapshot.reactions as number | null)} · comentários {fmt(post.snapshot.comments as number | null)} · reposts {fmt(post.snapshot.reposts as number | null)} · saves {fmt(post.snapshot.saves as number | null)} · visitas ao perfil {fmt(post.snapshot.profileViewsFromPost as number | null)} · seguidores {fmt(post.snapshot.followersGained as number | null)}</p></> : <p>Snapshot da janela selecionada indisponível.</p>}{post.snapshots.length > 0 ? <div className="analytics-post-tags">{post.snapshots.map((snapshot) => <span key={`${snapshot.window}:${snapshot.capturedAt}`}>{snapshot.window}: {fmt(snapshot.impressions)} impressões · alcance {fmt(snapshot.membersReached)} · atraso {fmt(snapshot.latenessHours)}h · {snapshot.source} / {snapshot.availability}</span>)}</div> : <p>Sem snapshots D+1/D+3/D+7 registrados.</p>}<details><summary>Proveniência e evidências</summary><pre>{JSON.stringify({ evidence: post.evidence, audience: post.snapshot?.audienceBreakdown }, null, 2)}</pre></details></article>)}</div> : <Empty>Não há publicações no período. Você pode registrar métricas manualmente ou importar relatório.</Empty>}</section>
      <section className="admin-panel analytics-import-panel"><h2>Importar exportação do LinkedIn</h2><p className="admin-subtitle">CSV/XLSX autenticado. IDs associam automaticamente; sem ID, escolha manualmente. Linhas não associadas são preservadas separadas e nunca distribuídas por título.</p><div className="analytics-import-actions"><input type="file" accept=".csv,.xlsx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /><button className="admin-button" type="button" disabled={!file || busy} onClick={() => void previewFile()}>{busy ? "Lendo…" : "Pré-visualizar e mapear"}</button></div>
        {preview && <><p>{preview.fileName} · {preview.totalRows} linhas</p><div className="analytics-mapping-grid">{preview.mappingFields.map((field) => <label className="admin-label" key={field}>{mappingLabels[field] ?? field}<select className="admin-input" value={mapping[field] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}><option value="">— não mapear —</option>{preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div><div className="analytics-row-preview"><strong>Associação dos posts (amostra de até 100 linhas)</strong>{preview.rows.slice(0, 100).map((row) => { const rawId = mapping.linkedinPostId ? row.values[mapping.linkedinPostId] : ""; const known = preview.posts.some((post) => post.linkedinPostId === rawId); return <label key={row.rowNumber}><span>Linha {row.rowNumber}{rawId && known ? " · LinkedIn ID reconhecido" : rawId ? " · ID sem correspondência" : " · associação necessária"}</span><select value={associations[String(row.rowNumber)] ?? ""} onChange={(event) => setAssociations((current) => ({ ...current, [String(row.rowNumber)]: event.target.value }))}><option value="">Manter separado como agregado/não associado</option>{preview.posts.map((post) => <option value={post.id} key={post.id}>{post.title} · {new Date(post.publishedAt).toLocaleDateString("pt-BR")}</option>)}</select></label>; })}</div><button className="admin-button active" type="button" disabled={busy} onClick={() => void importFile()}>{busy ? "Importando…" : "Confirmar importação"}</button></>}
      </section>
      <section className="admin-panel"><h2>Importações agregadas / não associadas</h2><p className="admin-subtitle">Essas linhas não entram nos rankings por publicação enquanto não houver associação confiável.</p>{report.aggregateImports.length ? <div className="analytics-comparison-grid">{report.aggregateImports.map((batch) => <article key={batch.id}><strong>{batch.fileName}</strong><span>{batch.sourceLabel} · {new Date(batch.capturedAt).toLocaleString("pt-BR")}</span><span>Status {batch.status} · {batch.rowsSeen} linhas · {batch.rowsImported} associadas · {batch.rowsUnmatched} não associadas</span><details><summary>Dados separados e erros</summary><pre>{JSON.stringify({ aggregateRows: batch.aggregateRows, errors: batch.errors }, null, 2)}</pre></details></article>)}</div> : <Empty>Nenhum relatório agregado ou não associado nesse período.</Empty>}</section>
      <section className="admin-panel"><h2>Entrada manual por publicação</h2><p className="admin-subtitle">Informe apenas valores observados. Campo vazio permanece desconhecido; zero precisa ser digitado explicitamente.</p><form className="analytics-manual-form" onSubmit={(event) => { event.preventDefault(); void saveManual(event.currentTarget); }}><label className="admin-label">Publicação<select className="admin-input" value={manualPost} onChange={(event) => setManualPost(event.target.value)}>{posts.map((post) => <option key={post.id} value={post.id}>{post.title}</option>)}</select></label><label className="admin-label">Janela<select className="admin-input" name="measurementWindow" defaultValue="7D"><option>24H</option><option>72H</option><option>7D</option><option>LIFETIME</option></select></label><label className="admin-label">Data/hora da observação<input className="admin-input" name="capturedAt" type="datetime-local" defaultValue={new Date().toISOString().slice(0, 16)} /></label><label className="admin-label">Origem / nota<input className="admin-input" name="sourceNote" required defaultValue="LinkedIn Analytics UI" /></label>{numericMetrics.map((field) => <label className="admin-label" key={field}>{mappingLabels[field] ?? field}<input className="admin-input" name={field} type="number" min="0" max={field.includes("Percent") ? 100 : undefined} step={field.includes("Percent") ? "0.01" : "1"} /></label>)}<button className="admin-button active" type="submit" disabled={busy || !manualPost}>{busy ? "Salvando…" : "Salvar snapshot"}</button></form></section>
      {postLabels.size > 0 && <p className="admin-meta">Postagens disponíveis para associação: {postLabels.size}. Importação não identificada permanece separada.</p>}
      <section className="analytics-limitations"><strong>Limitações e interpretação</strong><ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}<li>Comparações apresentam amostra e são descritivas; nenhuma alteração de calendário é automática.</li></ul></section>
    </>}
  </div>;
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="analytics-kpi"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
function Empty({ children }: { children: React.ReactNode }) { return <p className="analytics-empty">{children}</p>; }
