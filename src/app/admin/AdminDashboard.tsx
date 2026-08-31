"use client";

import { useMemo, useState } from "react";

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
}

export interface DashboardReference {
  id: string;
  content: string;
  sourceUrl: string | null;
  createdAt: string;
}

type View = "list" | "month" | "week";
type Toast = { text: string; kind: "success" | "error" };

const statusClass: Record<string, string> = {
  APPROVED: "approved", SCHEDULED: "scheduled", DRAFT: "draft", PUBLISHED: "published",
  REGENERATING: "regenerating", CANCELLED: "cancelled",
};
const visibleStatuses = new Set([
  "APPROVED", "SCHEDULED", "DRAFT", "PUBLISHED", "AWAITING_APPROVAL", "REGENERATING", "CANCELLED",
]);
const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function dateKey(value: string): string { return value.slice(0, 10); }
function formatDate(value: string): string { return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
function isExpired(post: DashboardPost): boolean {
  return !["PUBLISHED", "CANCELLED", "REGENERATING"].includes(post.status)
    && new Date(post.scheduledDate).getTime() < Date.now();
}

export function AdminDashboard({
  initialPosts,
  initialReferences,
}: {
  initialPosts: DashboardPost[];
  initialReferences: DashboardReference[];
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [references, setReferences] = useState(initialReferences);
  const [view, setView] = useState<View>("list");
  const [editing, setEditing] = useState<string | null>(null);
  const [aiPost, setAiPost] = useState<DashboardPost | null>(null);
  const [aiFeedback, setAiFeedback] = useState("");
  const [token, setToken] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [toast, setToast] = useState<Toast | null>(null);

  const visiblePosts = useMemo(() => posts.filter((post) => visibleStatuses.has(post.status)), [posts]);
  const monthCells = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00`);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return Array.from({ length: offset + days }, (_, index) => index < offset ? null : index - offset + 1);
  }, [month]);
  const weekStart = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
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

  async function save(post: DashboardPost, form: HTMLFormElement) {
    const data = new FormData(form);
    const scheduledDate = new Date(String(data.get("scheduledDate") ?? ""));
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
        notify(response.status === 401 ? "Token inválido ou ausente." : payload?.error ?? `Não foi possível iniciar (${response.status}).`, "error");
        return;
      }
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, status: "REGENERATING" } : item));
      setAiPost(null);
      setAiFeedback("");
      notify("IA e gerador de imagem acionados. Aguarde o novo card no Telegram.");
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

  function eventsFor(day: string): DashboardPost[] { return visiblePosts.filter((post) => dateKey(post.scheduledDate) === day); }

  return <main className="admin-shell"><div className="admin-container">
    {toast && <div className={`admin-toast ${toast.kind}`} role="status">{toast.text}</div>}
    <header className="admin-header"><div><div className="admin-kicker">Autonomous LinkedIn Content Engine</div><h1 className="admin-title">Agenda editorial</h1><p className="admin-subtitle">Acompanhe aprovação, publicação, aprendizado e melhoria assistida por IA.</p></div></header>
    <section className="admin-panel">
      <div className="admin-toolbar">
        {["list", "month", "week"].map((item) => <button key={item} className={`admin-button ${view === item ? "active" : ""}`} onClick={() => setView(item as View)}>{item === "list" ? "Timeline" : item === "month" ? "Calendário mensal" : "Semana atual"}</button>)}
        <input className="admin-input admin-token" type="password" placeholder="DASHBOARD_ADMIN_TOKEN (para editar)" value={token} onChange={(event) => setToken(event.target.value)} />
      </div>
      {view === "list" && <div className="admin-list">{visiblePosts.map((post) => <article className={`admin-card ${statusClass[post.status] ?? ""}`} key={post.id}>
        <div className="admin-card-head"><div><strong>{post.title}</strong><div className="admin-meta">{post.editorialPillar} · {formatDate(post.scheduledDate)} · {post.engagementScore === null ? "sem score" : `${Math.round(post.engagementScore)}/100 (${post.engagementLabel ?? ""})`}</div></div><span className="admin-status">{post.status}</span></div>
        {isExpired(post) && <div className="admin-expired">⚠️ Data expirada — reagende ou cancele este post.</div>}
        {post.mediaUrl && <div className="admin-media">{post.mediaUrl.toLowerCase().includes(".pdf") ? <a href={post.mediaUrl} target="_blank" rel="noreferrer">📄 Abrir PDF do carrossel</a> : <img src={post.mediaUrl} alt={`Criativo de ${post.title}`} loading="lazy" />}</div>}
        {editing === post.id ? <form className="admin-edit" onSubmit={(event) => { event.preventDefault(); void save(post, event.currentTarget); }}><input className="admin-input" name="title" defaultValue={post.title} /><textarea className="admin-textarea" name="textContent" defaultValue={post.textContent} /><textarea className="admin-textarea" name="imagePrompt" placeholder="Prompt da imagem" defaultValue={post.imagePrompt ?? ""} /><label className="admin-label">Data e hora de publicação (reagendamento)<input className="admin-input" name="scheduledDate" type="datetime-local" defaultValue={post.scheduledDate.slice(0, 16)} /></label><div className="admin-actions"><button className="admin-button active" type="submit">Salvar alterações</button><button className="admin-button" type="button" onClick={() => setEditing(null)}>Cancelar edição</button></div></form> : <div className="admin-actions">{post.status !== "PUBLISHED" && post.status !== "CANCELLED" && <><button className="admin-button" disabled={post.status === "REGENERATING"} onClick={() => setEditing(post.id)}>{isExpired(post) ? "Reagendar" : "Editar"}</button><button className="admin-button ai-button" disabled={post.status === "REGENERATING"} onClick={() => { setAiPost(post); setAiFeedback(""); }}>{post.status === "REGENERATING" ? "IA processando…" : "✨ Solicitar alteração por IA"}</button><button className="admin-button danger-button" disabled={post.status === "REGENERATING"} onClick={() => void cancelPost(post)}>Cancelar post</button></>}</div>}
      </article>)}</div>}
      {view === "month" && <><div className="admin-toolbar"><button className="admin-button" onClick={() => setMonth((value) => { const date = new Date(`${value}-01T00:00:00`); date.setMonth(date.getMonth() - 1); return date.toISOString().slice(0, 7); })}>←</button><strong>{month}</strong><button className="admin-button" onClick={() => setMonth((value) => { const date = new Date(`${value}-01T00:00:00`); date.setMonth(date.getMonth() + 1); return date.toISOString().slice(0, 7); })}>→</button></div><div className="admin-grid">{weekdays.map((day) => <div className="admin-weekday" key={day}>{day}</div>)}{monthCells.map((day, index) => { const key = day === null ? `empty-${index}` : `${month}-${String(day).padStart(2, "0")}`; return <div className={`admin-day ${day === null ? "muted" : ""}`} key={key}><div className="admin-day-number">{day ?? ""}</div>{day !== null && eventsFor(key).map((post) => <div className={`admin-event ${statusClass[post.status] ?? ""}`} key={post.id}><strong>{post.editorialPillar} · {post.title}</strong>{post.status} · {formatDate(post.scheduledDate)}</div>)}</div>; })}</div></>}
      {view === "week" && <div className="admin-list">{Array.from({ length: 7 }, (_, index) => { const date = new Date(weekStart.getTime() + index * 86400000); const key = date.toISOString().slice(0, 10); return <section className="admin-card" key={key}><strong>{date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</strong>{weekPosts.filter((post) => dateKey(post.scheduledDate) === key).map((post) => <div className={`admin-event ${statusClass[post.status] ?? ""}`} key={post.id}><strong>{post.title}</strong>{post.status} · {formatDate(post.scheduledDate)}</div>)}</section>; })}</div>}
    </section>
    <section className="admin-panel admin-references"><div className="admin-section-heading"><div><div className="admin-kicker">RAG editorial</div><h2>Referências de posts do LinkedIn</h2><p className="admin-subtitle">Adicione links e, opcionalmente, anote o que deve ser aprendido. O gerador usará esse repertório nas próximas rodadas.</p></div></div>
      <form className="admin-reference-form" onSubmit={(event) => { event.preventDefault(); void addReference(event.currentTarget); }}><input className="admin-input" name="sourceUrl" type="url" required placeholder="https://www.linkedin.com/posts/..." /><textarea className="admin-textarea" name="notes" placeholder="O que vale estudar neste post? Gancho, estrutura, tom, CTA, formato visual…" /><button className="admin-button active" type="submit">Adicionar referência ao RAG</button></form>
      <div className="admin-reference-list">{references.length === 0 ? <p className="admin-meta">Nenhuma referência cadastrada.</p> : references.map((reference) => <div className="admin-reference" key={reference.id}><div><a href={reference.sourceUrl ?? undefined} target="_blank" rel="noreferrer">{reference.sourceUrl ?? "Referência"}</a><p>{reference.content}</p><small>{formatDate(reference.createdAt)}</small></div><button type="button" className="admin-button" onClick={() => void removeReference(reference.id)}>Remover</button></div>)}</div>
    </section>
    {aiPost && <div className="admin-modal-backdrop" role="presentation"><div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="ai-title"><h2 id="ai-title">Solicitar alteração por IA</h2><p className="admin-subtitle">A IA irá reescrever o texto e gerar um novo criativo. O post continuará com o mesmo ID e data programada, mas voltará para aprovação.</p><p><strong>{aiPost.title}</strong></p><textarea className="admin-textarea" autoFocus value={aiFeedback} onChange={(event) => setAiFeedback(event.target.value)} placeholder="Ex.: deixe o gancho mais direto, aprofunde o trade-off técnico e troque a imagem para 3D minimalista, mantendo a paleta atual." /><div className="admin-actions"><button className="admin-button ai-button" type="button" onClick={() => void regenerate(aiPost)}>Enviar para IA + imagem</button><button className="admin-button" type="button" onClick={() => setAiPost(null)}>Fechar</button></div></div></div>}
  </div></main>;
}
