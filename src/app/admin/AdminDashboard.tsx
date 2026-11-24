"use client";

import { useEffect, useMemo, useState } from "react";
import { dateKeyInBrazil, formatDateInBrazil, formatDateTimeLocalInBrazil, parseDateTimeLocalInBrazil } from "@/lib/dates";
import { AdminNav } from "./AdminNav";
import type { EditorialScheduleSlot } from "@/lib/editorial-calendar";

export interface DashboardPost {
  id: string;
  title: string;
  textContent: string;
  imagePrompt: string | null;
  mediaUrl: string | null;
  editorialPillar: string;
  status: string;
  scheduledFor: string;
  scheduledDate: string;
  engagementScore: number | null;
  engagementLabel: string | null;
  language?: string;
  topic?: string | null;
  editorialObjective?: string | null;
  formatType?: string;
  qualityScore?: number | null;
  qualityStatus?: string | null;
  qualityReview?: unknown;
  evidenceSnapshot?: unknown;
  creativeBrief?: {
    id: string; version: number; postVersionId: string | null; thesis: string; technicalConflict: string;
    concreteProblem: string; visualConcept: string; shortOverlayTitle: string | null; effectivePrompt: string | null;
    mediaUrl: string | null; aestheticScore: number | null; semanticScore: number | null; technicalScore: number | null;
    reviewStatus: string | null; reviewSnapshot: unknown; contentBrief: unknown; visualBrief: unknown;
  } | null;
  currentVersionId?: string | null;
}

export interface DashboardReference {
  id: string;
  content: string;
  sourceUrl: string | null;
  createdAt: string;
}

type View = "list" | "month" | "week";
type Toast = { text: string; kind: "success" | "error" };
type EditorialPlan = { postsPerWeek: number; languageDistribution: { "pt-BR": number; "en-US": number }; weeklySchedule: EditorialScheduleSlot[] };
type CreativePackage = { markdown: string; chatGptPrompt: string; caption: string; mediaUrl: string | null; formatType: string; error?: string };

const statusClass: Record<string, string> = {
  APPROVED: "approved", SCHEDULED: "scheduled", DRAFT: "draft", PUBLISHED: "published",
  REGENERATING: "regenerating", PUBLISHING: "publishing", CANCELLED: "cancelled", ARCHIVED: "cancelled",
};
const activeStatuses = new Set(["APPROVED", "SCHEDULED", "DRAFT", "PUBLISHED", "AWAITING_APPROVAL", "REGENERATING", "PUBLISHING"]);
const backlogStatuses = new Set(["CANCELLED", "ARCHIVED", "REJECTED", "REJECTED_PENDING_FEEDBACK"]);
const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function dateKey(value: string): string { return dateKeyInBrazil(new Date(value)); }
function formatDate(value: string): string { return formatDateInBrazil(new Date(value)); }
function isExpired(post: DashboardPost): boolean {
  return !["PUBLISHED", "CANCELLED", "REGENERATING"].includes(post.status)
    && new Date(post.scheduledDate).getTime() < Date.now();
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function scoreLabel(value: unknown, suffix = "/100"): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value}${suffix}` : "Não disponível";
}

function EvaluationDetails({ post, busy, onReevaluate }: { post: DashboardPost; busy: boolean; onReevaluate: (post: DashboardPost) => void }) {
  const review = objectValue(post.qualityReview);
  const evaluation = objectValue(review?.evaluation);
  const intel = objectValue(review?.editorialIntelligence);
  const career = objectValue(intel?.careerRelevance);
  const hook = objectValue(intel?.hookQuality);
  const claims = objectValue(review?.claims);
  const dimensions = objectValue(review?.dimensions);
  const status = typeof evaluation?.status === "string" ? evaluation.status : post.qualityStatus ? "COMPLETED" : "NOT_EVALUATED";
  const evidence = Array.isArray(post.evidenceSnapshot) ? post.evidenceSnapshot : [];
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const creative = post.creativeBrief;
  const currentCreative = Boolean(creative && (!post.currentVersionId || creative.postVersionId === post.currentVersionId));

  return <details className="editorial-score-details">
    <summary>Avaliação editorial detalhada · {status === "NOT_EVALUATED" ? "Não avaliado" : status === "RUNNING" ? "Avaliando" : status === "FAILED" ? "Falha na avaliação" : post.qualityStatus ?? status}</summary>
    <div className="admin-actions"><span className="admin-status">Quality Gate: {post.qualityStatus ?? "Não avaliado"}</span><span className="admin-status">Score: {scoreLabel(post.qualityScore)}</span><span className="admin-status">Avaliador: {typeof evaluation?.method === "string" ? evaluation.method : "Não executado"}</span><button className="admin-button" disabled={busy} onClick={() => onReevaluate(post)}>{busy ? "Avaliando…" : "Reavaliar este conteúdo"}</button></div>
    {typeof evaluation?.error === "string" && <p className="admin-error">{evaluation.error}</p>}
    <div className="editorial-review-summary"><span>Career Relevance {scoreLabel(career?.score, "/5")}</span><span>Hook Quality {scoreLabel(hook?.score)}</span><span>Versão {typeof evaluation?.contentVersionId === "string" ? evaluation.contentVersionId : "sem snapshot de versão"}</span><span>Duração {typeof evaluation?.elapsedMs === "number" ? `${evaluation.elapsedMs} ms` : "n/d"}</span></div>
    <h4>Career Relevance</h4><p>{strings(career?.rationale).join(" ") || "Não avaliado."}</p><pre>{JSON.stringify(career?.breakdown ?? null, null, 2)}</pre>
    <h4>Hook Quality</h4><p>{strings(hook?.rationale).join(" ") || "Não avaliado."}</p><pre>{JSON.stringify(hook?.breakdown ?? null, null, 2)}</pre>
    <h4>Evidence Gate</h4><p>Resultado: {claims?.blocked === true ? "BLOCKED" : claims ? "Verificado" : "Não disponível"}. Fontes: {strings(claims?.evidenceSources).join(", ") || "não registradas"}</p>
    {strings(claims?.supportedClaims).length > 0 && <p><strong>Afirmações sustentadas:</strong> {strings(claims?.supportedClaims).join(" · ")}</p>}
    {strings(claims?.unsupportedClaims).length > 0 && <p className="admin-error"><strong>Não comprovadas:</strong> {strings(claims?.unsupportedClaims).join(" · ")}</p>}
    {evidence.length > 0 && <ul>{evidence.map((item, index) => { const row = objectValue(item); return <li key={index}><strong>{String(row?.claimClassification ?? row?.kind ?? "Evidência")}:</strong> {String(row?.claim ?? "")} {row?.source ? `(fonte: ${String(row.source)})` : ""}</li>; })}</ul>}
    <h4>Quality Gate e recomendações</h4><p>{typeof review?.summary === "string" ? review.summary : "Avaliação não executada."}</p><pre>{JSON.stringify(dimensions ?? null, null, 2)}</pre>
    {strings(review?.textIssues).length + strings(review?.visualIssues).length > 0 && <ul>{[...strings(review?.textIssues), ...strings(review?.visualIssues)].map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
    {strings(review?.recommendations).length > 0 && <p><strong>Ajustes sugeridos:</strong> {strings(review?.recommendations).join(" · ")}</p>}
    <h4>Creative Brief {creative ? `v${creative.version}` : ""}</h4>
    {!creative || !currentCreative ? <p>Briefing ausente ou não associado à versão avaliada; não será apresentado como atual.</p> : <>
      <p><strong>Tese:</strong> {creative.thesis}<br/><strong>Conflito:</strong> {creative.technicalConflict}<br/><strong>Problema:</strong> {creative.concreteProblem}<br/><strong>Conceito visual:</strong> {creative.visualConcept}<br/><strong>Headline:</strong> {creative.shortOverlayTitle ?? "Não definida"}</p>
      <p>Imagem: estética {scoreLabel(creative.aestheticScore)} · aderência {scoreLabel(creative.semanticScore)} · precisão técnica {scoreLabel(creative.technicalScore)} · status {creative.reviewStatus ?? "Não avaliada"}</p>
      <details><summary>VisualBrief, prompt efetivo e snapshot da revisão</summary><pre>{JSON.stringify({ visualBrief: creative.visualBrief, prompt: creative.effectivePrompt, review: creative.reviewSnapshot }, null, 2)}</pre></details>
    </>}
  </details>;
}

function editorialMeta(post: DashboardPost): { theme: string; career: string; hook: string; visualFormat: string; careerRationale: string[]; hookRationale: string[]; breakdown: string; claims: string[] } {
  const review = objectValue(post.qualityReview);
  const intelligence = objectValue(review?.editorialIntelligence);
  const career = objectValue(intelligence?.careerRelevance);
  const hook = objectValue(intelligence?.hookQuality);
  const careerBreakdown = objectValue(career?.breakdown);
  const hookBreakdown = objectValue(hook?.breakdown);
  const rationale = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const evidence = Array.isArray(post.evidenceSnapshot) ? post.evidenceSnapshot : [];
  const claims = evidence.flatMap((item) => {
    const record = objectValue(item);
    return typeof record?.claim === "string" ? [`${typeof record.claimClassification === "string" ? record.claimClassification : record.kind ?? "EVIDÊNCIA"}: ${record.claim}`] : [];
  }).slice(0, 3);
  return {
    theme: typeof intelligence?.theme === "string" ? intelligence.theme : post.topic ?? "Tema não classificado",
    career: typeof career?.score === "number" ? `${career.score}/5` : "pendente",
    hook: typeof hook?.score === "number" ? `${hook.score}/100` : "pendente",
    visualFormat: typeof intelligence?.visualFormat === "string" ? intelligence.visualFormat : "pendente",
    careerRationale: rationale(career?.rationale),
    hookRationale: rationale(hook?.rationale),
    breakdown: JSON.stringify({ career: careerBreakdown, hook: hookBreakdown }, null, 2),
    claims,
  };
}

export function AdminDashboard({
  initialPosts,
  initialReferences,
  initialEditorialPlan,
}: {
  initialPosts: DashboardPost[];
  initialReferences: DashboardReference[];
  initialEditorialPlan: EditorialPlan;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [references, setReferences] = useState(initialReferences);
  const [view, setView] = useState<View>("list");
  const [showBacklog, setShowBacklog] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [aiPost, setAiPost] = useState<DashboardPost | null>(null);
  const [aiFeedback, setAiFeedback] = useState("");
  const [token] = useState("session");
  const [month, setMonth] = useState(() => formatDateTimeLocalInBrazil(new Date()).slice(0, 7));
  const [publishing, setPublishing] = useState<string | null>(null);
  const [metricsPostId, setMetricsPostId] = useState("");
  const [metrics, setMetrics] = useState({ impressions: "", reactions: "", comments: "", shares: "", profileViews: "" });
  const [toast, setToast] = useState<Toast | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editorialPlan, setEditorialPlan] = useState(initialEditorialPlan);
  const [savingEditorialPlan, setSavingEditorialPlan] = useState(false);
  const [studioPost, setStudioPost] = useState<string | null>(null);
  const [studioPostId, setStudioPostId] = useState("");
  const [creativePackage, setCreativePackage] = useState<CreativePackage | null>(null);
  const [loadingCreativePackage, setLoadingCreativePackage] = useState(false);
  const [reviewingPostId, setReviewingPostId] = useState<string | null>(null);

  const visiblePosts = useMemo(() => posts.filter((post) => (showBacklog ? backlogStatuses : activeStatuses).has(post.status)), [posts, showBacklog]);
  const monthCells = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00`);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return Array.from({ length: offset + days }, (_, index) => index < offset ? null : index - offset + 1);
  }, [month]);
  const weekStart = useMemo(() => {
    const today = formatDateTimeLocalInBrazil(new Date()).slice(0, 10);
    const date = parseDateTimeLocalInBrazil(`${today}T00:00`);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    date.setUTCDate(date.getUTCDate() - ((weekday + 6) % 7));
    return date;
  }, []);
  const weekPosts = visiblePosts.filter((post) => {
    const date = new Date(post.scheduledDate);
    return date >= weekStart && date < new Date(weekStart.getTime() + 7 * 86400000);
  });

  function notify(text: string, kind: Toast["kind"] = "success") {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 5000);
  }

  function authHeaders(): HeadersInit {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const response = await fetch(`/api/posts?view=${showBacklog ? "backlog" : "active"}`, { headers: authHeaders(), cache: "no-store" });
      if (!response.ok || !mounted) return;
      setPosts(await response.json() as DashboardPost[]);
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [showBacklog]);

  async function save(post: DashboardPost, form: HTMLFormElement) {
    const data = new FormData(form);
    let scheduledDate: Date;
    try { scheduledDate = parseDateTimeLocalInBrazil(String(data.get("scheduledDate") ?? "")); }
    catch { notify("Informe uma data e horário válidos.", "error"); return; }
    if (Number.isNaN(scheduledDate.getTime())) { notify("Informe uma data e horário válidos.", "error"); return; }
    try {
      const response = await fetch(`/api/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          title: data.get("title"), textContent: data.get("textContent"),
          imagePrompt: data.get("imagePrompt"), scheduledDate: scheduledDate.toISOString(),
        }),
      });
      if (!response.ok) {
        notify(response.status === 401 ? "Token inválido ou ausente." : `Não foi possível salvar (${response.status}).`, "error");
        return;
      }
      const updated = await response.json() as DashboardPost;
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, ...updated } : item));
      setEditing(null);
      notify("Alterações salvas.");
    } catch { notify("Falha de rede ao salvar.", "error"); }
  }

  async function refreshPost(postId: string): Promise<void> {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const response = await fetch(`/api/posts/${postId}`, { headers: authHeaders(), cache: "no-store" });
      if (!response.ok) { notify("Não foi possível atualizar o status da reformulação.", "error"); return; }
      const updated = await response.json() as DashboardPost;
      setPosts((current) => current.map((item) => item.id === postId ? { ...item, ...updated } : item));
      if (updated.status !== "REGENERATING") {
        notify("Post reformulado e novo criativo disponível para aprovação.");
        return;
      }
    }
    notify("A reformulação ainda está processando. Atualize a página em alguns segundos.");
  }

  async function reevaluatePost(post: DashboardPost) {
    setReviewingPostId(post.id);
    try {
      const response = await fetch(`/api/posts/${post.id}/review`, { method: "POST", headers: authHeaders() });
      const payload = await response.json() as { error?: string; post?: Partial<DashboardPost> };
      if (!response.ok) throw new Error(payload.error ?? `Falha na reavaliação (${response.status}).`);
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, ...payload.post } : item));
      notify("Avaliação atualizada para a versão atual. O post continua sem aprovação automática.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível reavaliar o conteúdo.", "error");
    } finally { setReviewingPostId(null); }
  }

  async function regenerate(post: DashboardPost) {
    const feedback = aiFeedback.trim();
    if (feedback.length < 5) { notify("Descreva o que deseja melhorar para a IA.", "error"); return; }
    try {
      const response = await fetch(`/api/posts/${post.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ feedback }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        notify(payload?.error ?? (response.status === 401 ? "Token inválido ou ausente." : `Não foi possível iniciar (${response.status}).`), "error");
        return;
      }
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, status: "REGENERATING" } : item));
      setAiPost(null);
      setAiFeedback("");
      notify("IA e gerador de imagem acionados. A versão revisada aparecerá nesta tela após o processamento.");
      void refreshPost(post.id);
    } catch { notify("Falha de rede ao iniciar a reformulação.", "error"); }
  }

  async function cancelPost(post: DashboardPost) {
    if (!window.confirm(`Cancelar o post “${post.title}”?`)) return;
    try {
      const response = await fetch(`/api/posts/${post.id}`, { method: "DELETE", headers: authHeaders() });
      if (!response.ok) {
        notify(response.status === 401 ? "Token inválido ou ausente." : `Não foi possível cancelar (${response.status}).`, "error");
        return;
      }
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, status: "CANCELLED" } : item));
      notify("Post cancelado. O histórico foi preservado.");
    } catch { notify("Falha de rede ao cancelar o post.", "error"); }
  }

  async function publishNow(post: DashboardPost) {
    if (!isExpired(post) || !["APPROVED", "SCHEDULED"].includes(post.status)) return;
    setPublishing(post.id);
    try {
      const response = await fetch("/api/linkedin/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ postId: post.id }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; reason?: string; details?: string; providerStatus?: number } | null;
      if (!response.ok) {
        const provider = payload?.providerStatus ? ` LinkedIn HTTP ${payload.providerStatus}.` : "";
        const details = payload?.details ? ` ${payload.details}` : "";
        notify(`${payload?.error ?? payload?.reason ?? `Não foi possível publicar (${response.status}).`}${provider}${details}`.slice(0, 900), "error");
        return;
      }
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, status: "PUBLISHED" } : item));
      notify("Post publicado no LinkedIn.");
    } catch { notify("Falha de rede ao publicar o post.", "error"); }
    finally { setPublishing(null); }
  }

  async function uploadMedia(post: DashboardPost, file: File): Promise<void> {
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/posts/" + post.id + "/media", { method: "POST", headers: authHeaders(), body: form });
      const payload = await response.json().catch(() => null) as { mediaUrl?: string; status?: string; qualityStatus?: string; error?: string } | null;
      if (!response.ok || !payload?.mediaUrl) { notify(payload?.error ?? "Não foi possível substituir a mídia.", "error"); return; }
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, mediaUrl: payload.mediaUrl ?? null, status: payload.status ?? item.status } : item));
      notify(payload.qualityStatus === "PASS" ? "Imagem inspecionada e disponível no Dashboard para revisão." : "Imagem associada, mas o post continua bloqueado pelo quality gate.", payload.qualityStatus === "PASS" ? "success" : "error");
    } catch { notify("Falha de rede ao enviar a mídia.", "error"); }
  }

  async function addReference(form: HTMLFormElement) {
    const data = new FormData(form);
    const sourceUrl = String(data.get("sourceUrl") ?? "").trim();
    const notes = String(data.get("notes") ?? "").trim();
    try {
      const response = await fetch("/api/references", {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ sourceUrl, notes }),
      });
      const payload = await response.json() as DashboardReference & { error?: string };
      if (!response.ok) { notify(payload.error ?? `Não foi possível salvar a referência (${response.status}).`, "error"); return; }
      setReferences((current) => [payload, ...current.filter((item) => item.id !== payload.id)]);
      form.reset();
      notify("Referência adicionada ao repertório RAG.");
    } catch { notify("Falha de rede ao salvar a referência.", "error"); }
  }

  async function removeReference(id: string) {
    try {
      const response = await fetch(`/api/references/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!response.ok) { notify("Não foi possível remover a referência.", "error"); return; }
      setReferences((current) => current.filter((item) => item.id !== id));
      notify("Referência removida.");
    } catch { notify("Falha de rede ao remover a referência.", "error"); }
  }

  async function saveMetrics(form: HTMLFormElement) {
    if (!metricsPostId) { notify("Selecione um post publicado.", "error"); return; }
    const data = new FormData(form);
    try {
      const response = await fetch(`/api/posts/${metricsPostId}/metrics`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(Object.fromEntries(data.entries())) });
      const payload = await response.json() as { error?: string; interactionRate?: number | null };
      if (!response.ok) { notify(payload.error ?? "Não foi possível salvar as métricas.", "error"); return; }
      void payload.interactionRate;
      setMetrics({ impressions: "", reactions: "", comments: "", shares: "", profileViews: "" });
      notify("Snapshot de métricas salvo. O score projetado do post não foi alterado.");
    } catch { notify("Falha de rede ao salvar métricas.", "error"); }
  }

  async function generateBatch() {
    setGenerating(true);
    try {
      const knownPostIds = new Set(posts.map((post) => post.id));
      const today = formatDateTimeLocalInBrazil(new Date()).slice(0, 10);
      const monday = parseDateTimeLocalInBrazil(`${today}T00:00`);
      const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
      monday.setUTCDate(monday.getUTCDate() - ((weekday + 6) % 7) + 7);
      const weekStart = formatDateTimeLocalInBrazil(monday).slice(0, 10);
      const response = await fetch("/api/posts/generate", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ weekStart }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? `Falha ao enfileirar lote (${response.status}).`);
      notify(`Geração do calendário de ${weekStart} iniciada. Vou acompanhar a execução e atualizar esta tela.`);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        const postsResponse = await fetch("/api/posts?view=active", { headers: authHeaders(), cache: "no-store" });
        if (!postsResponse.ok) continue;
        const currentPosts = await postsResponse.json() as DashboardPost[];
        setPosts(currentPosts);
        const newlyCreated = currentPosts.filter((post) => !knownPostIds.has(post.id));
        if (newlyCreated.length > 0) {
          notify(`${newlyCreated.length} novo(s) rascunho(s) carregado(s) no Dashboard. A revisão e aprovação são feitas aqui.`);
          return;
        }
      }
      notify("O pedido foi aceito, mas nenhum novo rascunho apareceu após 5 minutos. Verifique a execução da função no Inngest.", "error");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao gerar lote.", "error"); }
    finally { setGenerating(false); }
  }

  async function saveEditorialPlan() {
    setSavingEditorialPlan(true);
    try {
      const response = await fetch("/api/admin/editorial-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ weeklySchedule: editorialPlan.weeklySchedule }),
      });
      const payload = await response.json() as { error?: string; weeklySchedule?: EditorialScheduleSlot[] };
      if (!response.ok || !payload.weeklySchedule) throw new Error(payload.error ?? "Não foi possível salvar o calendário.");
      setEditorialPlan((current) => ({ ...current, weeklySchedule: payload.weeklySchedule! }));
      notify("Horários salvos. Idiomas e objetivos dos quatro slots permanecem fixos.");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao salvar planejamento.", "error"); }
    finally { setSavingEditorialPlan(false); }
  }

  async function openCreativeStudio(post: DashboardPost) {
    setStudioPost(post.id);
    setCreativePackage(null);
    setLoadingCreativePackage(true);
    try {
      const response = await fetch(`/api/posts/${post.id}/creative-package`, { headers: authHeaders(), cache: "no-store" });
      const payload = await response.json() as CreativePackage;
      if (!response.ok) throw new Error(payload.error ?? `Falha ao preparar pacote (${response.status}).`);
      setCreativePackage(payload);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível abrir o Creative Studio.", "error");
      setStudioPost(null);
    } finally { setLoadingCreativePackage(false); }
  }

  async function copyCreativeText(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); notify(`${label} copiado.`); }
    catch { notify("Não foi possível acessar a área de transferência neste navegador.", "error"); }
  }

  function eventsFor(day: string): DashboardPost[] { return visiblePosts.filter((post) => dateKey(post.scheduledDate) === day); }

  return <main className="admin-shell"><div className="admin-container"><AdminNav current="agenda" />
    {toast && <div className={`admin-toast ${toast.kind}`} role="status">{toast.text}</div>}
    <header className="admin-header"><div><div className="admin-kicker">Autonomous LinkedIn Content Engine</div><h1 className="admin-title">Agenda editorial</h1><p className="admin-subtitle">Acompanhe aprovação, publicação, aprendizado e melhoria assistida por IA.</p></div></header>
    <section className="admin-panel">
      <div className="admin-toolbar">
        {["list", "month", "week"].map((item) => <button key={item} className={`admin-button ${view === item ? "active" : ""}`} onClick={() => setView(item as View)}>{item === "list" ? "Timeline" : item === "month" ? "Calendário mensal" : "Semana atual"}</button>)}
        <button className={`admin-button ${!showBacklog ? "active" : ""}`} onClick={() => setShowBacklog(false)}>Ativos</button>
        <button className={`admin-button ${showBacklog ? "active" : ""}`} onClick={() => setShowBacklog(true)}>Backlog</button>
        <button className="admin-button active" disabled={generating} onClick={() => void generateBatch()}>{generating ? "Enfileirando..." : "Gerar calendário da próxima semana"}</button><button className="admin-button" onClick={() => { void fetch("/api/auth/logout", { method: "POST" }).then(() => window.location.assign("/admin")); }}>Sair</button>
      </div>
      <section className="admin-card" aria-labelledby="language-plan-title">
        <div className="admin-kicker">Calendário-base · America/Sao_Paulo</div><h2 id="language-plan-title">Quatro slots editoriais por semana</h2>
        <div className="admin-actions editorial-slots">
          {editorialPlan.weeklySchedule.map((slot, index) => <label className="admin-label" key={`${slot.weekday}-${slot.language}`}>
            {[["Segunda", "EN", "Discovery"], ["Terça", "PT-BR", "Authority"], ["Quinta", "EN", "Proof"], ["Sexta", "PT-BR", "Career Conversion"]][index].join(" · ")}
            <input className="admin-input" type="time" value={slot.localTime} onChange={(event) => setEditorialPlan((current) => ({ ...current, weeklySchedule: current.weeklySchedule.map((item, itemIndex) => itemIndex === index ? { ...item, localTime: event.target.value } : item) }))} />
          </label>)}
          <button className="admin-button active" disabled={savingEditorialPlan} onClick={() => void saveEditorialPlan()}>{savingEditorialPlan ? "Salvando…" : "Salvar horários"}</button>
        </div>
        <p className="admin-meta">Baseline experimental: 2 publicações em inglês e 2 em português. Ajustar horários não altera posts existentes nem aprova/publica conteúdo.</p>
      </section>
      {view === "list" && <div className="admin-list">{visiblePosts.map((post) => <article className={`admin-card ${statusClass[post.status] ?? ""}`} key={post.id}>
        <div className="admin-card-head"><div><strong>{post.title}</strong><div className="admin-meta">{post.editorialPillar} · {formatDate(post.scheduledDate)} · {post.engagementScore === null ? "sem score" : `${Math.round(post.engagementScore)}/100 (${post.engagementLabel ?? ""})`}</div></div><span className="admin-status">{post.status}</span></div>
        <div className="editorial-review-summary"><span>{post.language === "en-US" ? "EN" : "PT-BR"}</span><span>{editorialMeta(post).theme}</span><span>{post.editorialObjective ?? "Objetivo pendente"}</span><span>Carreira {editorialMeta(post).career}</span><span>Hook {editorialMeta(post).hook}</span><span>{editorialMeta(post).visualFormat}</span><span>{post.formatType ?? "formato pendente"}</span><span>Quality {post.qualityStatus ?? "pending"}{post.qualityScore === null || post.qualityScore === undefined ? "" : ` · ${post.qualityScore}/100`}</span></div>
        {editorialMeta(post).claims.length > 0 && <div className="admin-meta"><strong>Evidências:</strong> {editorialMeta(post).claims.join(" · ")}</div>}
        {(editorialMeta(post).careerRationale.length > 0 || editorialMeta(post).hookRationale.length > 0) && <details className="editorial-score-details"><summary>Ver justificativa dos scores</summary><p><strong>Career Relevance:</strong> {editorialMeta(post).careerRationale.join(" ")}</p><p><strong>Hook Quality:</strong> {editorialMeta(post).hookRationale.join(" ")}</p><pre>{editorialMeta(post).breakdown}</pre></details>}
        <EvaluationDetails post={post} busy={reviewingPostId === post.id} onReevaluate={reevaluatePost} />
        {isExpired(post) && <div className="admin-expired">⚠️ Data expirada — reagende ou cancele este post.</div>}
        {post.mediaUrl && <div className="admin-media">{post.mediaUrl.toLowerCase().includes(".pdf") ? <a href={post.mediaUrl} target="_blank" rel="noreferrer">📄 Abrir PDF do carrossel</a> : <img src={post.mediaUrl} alt={`Criativo de ${post.title}`} loading="lazy" />}</div>}
        {post.status !== "PUBLISHED" && post.status !== "CANCELLED" && <label className="admin-button">🖼️ Substituir imagem<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadMedia(post, file); event.currentTarget.value = ""; }} /></label>}
        {editing === post.id ? <form className="admin-edit" onSubmit={(event) => { event.preventDefault(); void save(post, event.currentTarget); }}><input className="admin-input" name="title" defaultValue={post.title} /><textarea className="admin-textarea" name="textContent" defaultValue={post.textContent} /><textarea className="admin-textarea" name="imagePrompt" placeholder="Prompt da imagem" defaultValue={post.imagePrompt ?? ""} /><label className="admin-label">Data e hora de publicação (reagendamento)<input className="admin-input" name="scheduledDate" type="datetime-local" defaultValue={post.scheduledDate.slice(0, 16)} /></label><div className="admin-actions"><button className="admin-button active" type="submit">Salvar alterações</button><button className="admin-button" type="button" onClick={() => setEditing(null)}>Cancelar edição</button></div></form> : <div className="admin-actions">{post.status !== "PUBLISHED" && post.status !== "CANCELLED" && <><button className="admin-button" disabled={post.status === "REGENERATING"} onClick={() => setEditing(post.id)}>{isExpired(post) ? "Reagendar" : "Editar"}</button><button className="admin-button ai-button" disabled={post.status === "REGENERATING"} onClick={() => { setAiPost(post); setAiFeedback(""); }}>{post.status === "REGENERATING" ? "IA processando…" : "✨ Solicitar alteração por IA"}</button><button className="admin-button danger-button" disabled={post.status === "REGENERATING"} onClick={() => void cancelPost(post)}>Cancelar post</button></>}</div>}
      {isExpired(post) && ["APPROVED", "SCHEDULED"].includes(post.status) && <div className="admin-actions"><button className="admin-button publish-button" disabled={publishing === post.id} onClick={() => void publishNow(post)}>{publishing === post.id ? "Publicando…" : "🚀 Publicar agora"}</button></div>}</article>)}</div>}
      {view === "month" && <><div className="admin-toolbar"><button className="admin-button" onClick={() => setMonth((value) => { const date = new Date(`${value}-01T00:00:00`); date.setMonth(date.getMonth() - 1); return date.toISOString().slice(0, 7); })}>←</button><strong>{month}</strong><button className="admin-button" onClick={() => setMonth((value) => { const date = new Date(`${value}-01T00:00:00`); date.setMonth(date.getMonth() + 1); return date.toISOString().slice(0, 7); })}>→</button></div><div className="admin-grid">{weekdays.map((day) => <div className="admin-weekday" key={day}>{day}</div>)}{monthCells.map((day, index) => { const key = day === null ? `empty-${index}` : `${month}-${String(day).padStart(2, "0")}`; return <div className={`admin-day ${day === null ? "muted" : ""}`} key={key}><div className="admin-day-number">{day ?? ""}</div>{day !== null && eventsFor(key).map((post) => <div className={`admin-event ${statusClass[post.status] ?? ""}`} key={post.id}><strong>{post.editorialPillar} · {post.title}</strong>{post.status} · {formatDate(post.scheduledDate)}</div>)}</div>; })}</div></>}
      {view === "week" && <div className="admin-list">{Array.from({ length: 7 }, (_, index) => { const date = new Date(weekStart.getTime() + index * 86400000); const key = date.toISOString().slice(0, 10); return <section className="admin-card" key={key}><strong>{date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</strong>{weekPosts.filter((post) => dateKey(post.scheduledDate) === key).map((post) => <div className={`admin-event ${statusClass[post.status] ?? ""}`} key={post.id}><strong>{post.title}</strong>{post.status} · {formatDate(post.scheduledDate)}</div>)}</section>; })}</div>}
    </section>
    <section className="admin-panel admin-references"><div className="admin-section-heading"><div><div className="admin-kicker">RAG editorial</div><h2>Referências de posts do LinkedIn</h2><p className="admin-subtitle">Adicione links e, opcionalmente, anote o que deve ser aprendido. O gerador usará esse repertório nas próximas rodadas.</p></div></div>
      <form className="admin-reference-form" onSubmit={(event) => { event.preventDefault(); void addReference(event.currentTarget); }}><input className="admin-input" name="sourceUrl" type="url" required placeholder="https://www.linkedin.com/posts/..." /><textarea className="admin-textarea" name="notes" placeholder="O que vale estudar neste post? Gancho, estrutura, tom, CTA, formato visual…" /><button className="admin-button active" type="submit">Adicionar referência ao RAG</button></form>
      <div className="admin-reference-list">{references.length === 0 ? <p className="admin-meta">Nenhuma referência cadastrada.</p> : references.map((reference) => <div className="admin-reference" key={reference.id}><div><a href={reference.sourceUrl ?? undefined} target="_blank" rel="noreferrer">{reference.sourceUrl ?? "Referência"}</a><p>{reference.content}</p><small>{formatDate(reference.createdAt)}</small></div><button type="button" className="admin-button" onClick={() => void removeReference(reference.id)}>Remover</button></div>)}</div>
    </section>
    {aiPost && <div className="admin-modal-backdrop" role="presentation"><div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="ai-title"><h2 id="ai-title">Solicitar alteração por IA</h2><p className="admin-subtitle">A IA irá reescrever o texto e gerar um novo criativo. O post continuará com o mesmo ID e data programada, mas voltará para aprovação.</p><p><strong>{aiPost.title}</strong></p><textarea className="admin-textarea" autoFocus value={aiFeedback} onChange={(event) => setAiFeedback(event.target.value)} placeholder="Ex.: deixe o gancho mais direto, aprofunde o trade-off técnico e troque a imagem para 3D minimalista, mantendo a paleta atual." /><div className="admin-actions"><button className="admin-button ai-button" type="button" onClick={() => void regenerate(aiPost)}>Enviar para IA + imagem</button><button className="admin-button" type="button" onClick={() => setAiPost(null)}>Fechar</button></div></div></div>}
    <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Aprendizado real</div><h2>Registrar métricas do LinkedIn</h2><p className="admin-subtitle">Copie os números exibidos em “Ver análises” no LinkedIn. Esses dados serão usados para comparar temas, formatos e horários.</p></div></div><form className="admin-edit" onSubmit={(event) => { event.preventDefault(); void saveMetrics(event.currentTarget); }}><select className="admin-input" value={metricsPostId} onChange={(event) => setMetricsPostId(event.target.value)}><option value="">Selecione um post publicado</option>{posts.filter((post) => post.status === "PUBLISHED").map((post) => <option value={post.id} key={post.id}>{post.title}</option>)}</select><input className="admin-input" name="impressions" type="number" min="0" placeholder="Impressões" value={metrics.impressions} onChange={(event) => setMetrics((current) => ({ ...current, impressions: event.target.value }))} /><input className="admin-input" name="reactions" type="number" min="0" placeholder="Reações" value={metrics.reactions} onChange={(event) => setMetrics((current) => ({ ...current, reactions: event.target.value }))} /><input className="admin-input" name="comments" type="number" min="0" placeholder="Comentários" value={metrics.comments} onChange={(event) => setMetrics((current) => ({ ...current, comments: event.target.value }))} /><input className="admin-input" name="shares" type="number" min="0" placeholder="Compartilhamentos" value={metrics.shares} onChange={(event) => setMetrics((current) => ({ ...current, shares: event.target.value }))} /><input className="admin-input" name="profileViews" type="number" min="0" placeholder="Visitas ao perfil (opcional)" value={metrics.profileViews} onChange={(event) => setMetrics((current) => ({ ...current, profileViews: event.target.value }))} /><button className="admin-button active" type="submit">Salvar métricas</button></form></section>
    <section className="admin-panel"><div className="admin-kicker">Pacote de revisão externa</div><h2>ChatGPT Creative Studio</h2><p className="admin-subtitle">Exporte a legenda, as evidências correspondentes e um briefing visual compacto. Este recurso não gera, agenda nem publica conteúdo.</p><div className="admin-actions"><select className="admin-input" value={studioPostId} onChange={(event) => setStudioPostId(event.target.value)}><option value="">Selecione um post</option>{posts.map((post) => <option key={post.id} value={post.id}>{post.title}</option>)}</select><button className="admin-button active" disabled={!studioPostId || loadingCreativePackage} onClick={() => { const selected = posts.find((post) => post.id === studioPostId); if (selected) void openCreativeStudio(selected); }}>{loadingCreativePackage ? "Preparando…" : "Abrir pacote"}</button></div></section>
    {studioPost && <div className="admin-modal-backdrop" role="presentation"><section className="admin-modal creative-studio-modal" role="dialog" aria-modal="true" aria-labelledby="creative-studio-title"><div className="admin-kicker">Pacote exportável</div><h2 id="creative-studio-title">ChatGPT Creative Studio</h2>{loadingCreativePackage ? <p>Preparando contexto e evidências…</p> : creativePackage ? <><p className="admin-subtitle">Revise a copy, as evidências e a direção visual. O pacote não publica nem altera o post.</p>{creativePackage.mediaUrl && (creativePackage.formatType === "CAROUSEL_PDF" ? <a href={creativePackage.mediaUrl} target="_blank" rel="noreferrer">Abrir PDF atual do carrossel</a> : <img className="creative-studio-preview" src={creativePackage.mediaUrl} alt="Criativo atual do post" />)}<div className="admin-actions"><button className="admin-button active" onClick={() => void copyCreativeText(creativePackage.chatGptPrompt, "Prompt visual")}>Copiar prompt visual</button><button className="admin-button" onClick={() => void copyCreativeText(creativePackage.markdown, "Pacote completo")}>Copiar pacote</button><button className="admin-button" onClick={() => void copyCreativeText(creativePackage.caption, "Legenda")}>Copiar legenda</button></div><details><summary>Briefing e fontes</summary><pre className="creative-studio-brief">{creativePackage.markdown}</pre></details></> : <p>Não foi possível carregar o pacote.</p>}<div className="admin-actions"><button className="admin-button" onClick={() => { setStudioPost(null); setCreativePackage(null); }}>Fechar</button></div></section></div>}
  </div></main>;
}
