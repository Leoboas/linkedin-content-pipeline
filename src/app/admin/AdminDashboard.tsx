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
const statusClass: Record<string, string> = {
  APPROVED: "approved", SCHEDULED: "scheduled", DRAFT: "draft", PUBLISHED: "published", REGENERATING: "regenerating",
};
const visibleStatuses = new Set(["APPROVED", "SCHEDULED", "DRAFT", "PUBLISHED", "AWAITING_APPROVAL", "REGENERATING"]);
const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function dateKey(value: string): string { return value.slice(0, 10); }
function formatDate(value: string): string { return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }

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
  const [token, setToken] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [message, setMessage] = useState("");

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

  function authHeaders(): HeadersInit {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function save(post: DashboardPost, form: HTMLFormElement) {
    const data = new FormData(form);
    const scheduledDate = new Date(String(data.get("scheduledDate") ?? ""));
    if (Number.isNaN(scheduledDate.getTime())) { setMessage("Informe uma data e horário válidos."); return; }
    try {
      const response = await fetch(`/api/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ title: data.get("title"), textContent: data.get("textContent"), imagePrompt: data.get("imagePrompt"), scheduledDate: scheduledDate.toISOString() }),
      });
      if (!response.ok) {
        setMessage(response.status === 401 ? "Token inválido ou ausente. Informe o DASHBOARD_ADMIN_TOKEN da Production." : `Não foi possível salvar (${response.status}).`);
        return;
      }
      const updated = await response.json() as DashboardPost;
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, ...updated } : item));
      setEditing(null);
      setMessage("Alterações salvas.");
    } catch { setMessage("Falha de rede ao salvar."); }
  }

  async function refreshPost(postId: string): Promise<void> {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const response = await fetch(`/api/posts/${postId}`, { headers: authHeaders(), cache: "no-store" });
      if (!response.ok) return;
      const updated = await response.json() as DashboardPost;
      setPosts((current) => current.map((item) => item.id === postId ? { ...item, ...updated } : item));
      if (updated.status !== "REGENERATING") {
        setEditing(null);
        setMessage("Post reformulado e novo criativo disponível para aprovação.");
        return;
      }
    }
    setMessage("A reformulação ainda está em processamento. Atualize a página em alguns segundos.");
  }

  async function regenerate(post: DashboardPost, form: HTMLFormElement) {
    const feedback = String(new FormData(form).get("aiFeedback") ?? "").trim();
    if (feedback.length < 5) { setMessage("Descreva o que deseja melhorar para a IA."); return; }
    try {
      const response = await fetch(`/api/posts/${post.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ feedback }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        setMessage(response.status === 401 ? "Token inválido ou ausente. Informe o DASHBOARD_ADMIN_TOKEN da Production." : payload?.error ?? `Não foi possível iniciar (${response.status}).`);
        return;
      }
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, status: "REGENERATING" } : item));
      setMessage("IA e gerador de imagem acionados. Aguarde o novo card no Telegram.");
      void refreshPost(post.id);
    } catch { setMessage("Falha de rede ao iniciar a reformulação."); }
  }

  async function addReference(form: HTMLFormElement) {
    const data = new FormData(form);
    const sourceUrl = String(data.get("sourceUrl") ?? "").trim();
    const notes = String(data.get("notes") ?? "").trim();
    try {
      const response = await fetch("/api/references", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ sourceUrl, notes }),
      });
      const payload = await response.json() as DashboardReference & { error?: string };
      if (!response.ok) { setMessage(payload.error ?? `Não foi possível salvar a referência (${response.status}).`); return; }
      setReferences((current) => [payload, ...current.filter((item) => item.id !== payload.id)]);
      form.reset();
      setMessage("Referência adicionada ao repertório RAG.");
    } catch { setMessage("Falha de rede ao salvar a referência."); }
  }

  async function removeReference(id: string) {
    const response = await fetch(`/api/references/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!response.ok) { setMessage("Não foi possível remover a referência."); return; }
    setReferences((current) => current.filter((item) => item.id !== id));
    setMessage("Referência removida.");
  }

  function eventsFor(day: string): DashboardPost[] { return visiblePosts.filter((post) => dateKey(post.scheduledDate) === day); }

  return <main className="admin-shell"><div className="admin-container">
    <header className="admin-header"><div><div className="admin-kicker">Autonomous LinkedIn Content Engine</div><h1 className="admin-title">Agenda editorial</h1><p className="admin-subtitle">Acompanhe aprovação, publicação, aprendizado e melhoria assistida por IA.</p></div></header>
    <section className="admin-panel">
      <div className="admin-toolbar">
        {["list", "month", "week"].map((item) => <button key={item} className={`admin-button ${view === item ? "active" : ""}`} onClick={() => setView(item as View)}>{item === "list" ? "Timeline" : item === "month" ? "Calendário mensal" : "Semana atual"}</button>)}
        <input className="admin-input admin-token" type="password" placeholder="DASHBOARD_ADMIN_TOKEN (para editar)" value={token} onChange={(event) => setToken(event.target.value)} />
        {message && <span className="admin-meta">{message}</span>}
      </div>
      {view === "list" && <div className="admin-list">{visiblePosts.map((post) => <article className={`admin-card ${statusClass[post.status] ?? ""}`} key={post.id}>
        <div className="admin-card-head"><div><strong>{post.title}</strong><div className="admin-meta">{post.editorialPillar} · {formatDate(post.scheduledDate)} · {post.engagementScore === null ? "sem score" : `${Math.round(post.engagementScore)}/100 (${post.engagementLabel ?? ""})`}</div></div><span className="admin-status">{post.status}</span></div>
        {post.mediaUrl && <div className="admin-media">{post.mediaUrl.toLowerCase().includes(".pdf") ? <a href={post.mediaUrl} target="_blank" rel="noreferrer">📄 Abrir PDF do carrossel</a> : <img src={post.mediaUrl} alt={`Criativo de ${post.title}`} loading="lazy" />}</div>}
        {editing === post.id ? <form className="admin-edit" onSubmit={(event) => { event.preventDefault(); void save(post, event.currentTarget); }}><input className="admin-input" name="title" defaultValue={post.title} /><textarea className="admin-textarea" name="textContent" defaultValue={post.textContent} /><textarea className="admin-textarea" name="imagePrompt" placeholder="Prompt da imagem" defaultValue={post.imagePrompt ?? ""} /><input className="admin-input" name="scheduledDate" type="datetime-local" defaultValue={post.scheduledDate.slice(0, 16)} /><textarea className="admin-textarea admin-feedback" name="aiFeedback" placeholder="Melhoria para a IA (texto e imagem): ex. torne o gancho mais específico, use visual 3D minimalista e preserve a paleta azul/âmbar." /><div className="admin-actions"><button className="admin-button active" type="submit">Salvar alterações</button><button className="admin-button ai-button" type="button" disabled={post.status === "REGENERATING"} onClick={(event) => void regenerate(post, event.currentTarget.form!)}>{post.status === "REGENERATING" ? "IA processando…" : "✨ Melhorar com IA + imagem"}</button><button className="admin-button" type="button" onClick={() => setEditing(null)}>Cancelar</button></div></form> : <div className="admin-actions">{post.status !== "PUBLISHED" && <button className="admin-button" onClick={() => setEditing(post.id)}>Editar / melhorar</button>}</div>}
      </article>)}</div>}
      {view === "month" && <><div className="admin-toolbar"><button className="admin-button" onClick={() => setMonth((value) => { const date = new Date(`${value}-01T00:00:00`); date.setMonth(date.getMonth() - 1); return date.toISOString().slice(0, 7); })}>←</button><strong>{month}</strong><button className="admin-button" onClick={() => setMonth((value) => { const date = new Date(`${value}-01T00:00:00`); date.setMonth(date.getMonth() + 1); return date.toISOString().slice(0, 7); })}>→</button></div><div className="admin-grid">{weekdays.map((day) => <div className="admin-weekday" key={day}>{day}</div>)}{monthCells.map((day, index) => { const key = day === null ? `empty-${index}` : `${month}-${String(day).padStart(2, "0")}`; return <div className={`admin-day ${day === null ? "muted" : ""}`} key={key}><div className="admin-day-number">{day ?? ""}</div>{day !== null && eventsFor(key).map((post) => <div className={`admin-event ${statusClass[post.status] ?? ""}`} key={post.id}><strong>{post.editorialPillar} · {post.title}</strong>{post.status} · {formatDate(post.scheduledDate)}</div>)}</div>; })}</div></>}
      {view === "week" && <div className="admin-list">{Array.from({ length: 7 }, (_, index) => { const date = new Date(weekStart.getTime() + index * 86400000); const key = date.toISOString().slice(0, 10); return <section className="admin-card" key={key}><strong>{date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</strong>{weekPosts.filter((post) => dateKey(post.scheduledDate) === key).map((post) => <div className={`admin-event ${statusClass[post.status] ?? ""}`} key={post.id}><strong>{post.title}</strong>{post.status} · {formatDate(post.scheduledDate)}</div>)}</section>; })}</div>}
    </section>
    <section className="admin-panel admin-references"><div className="admin-section-heading"><div><div className="admin-kicker">RAG editorial</div><h2>Referências de posts do LinkedIn</h2><p className="admin-subtitle">Adicione links e, opcionalmente, anote o que deve ser aprendido. O gerador usará esse repertório nas próximas rodadas.</p></div></div>
      <form className="admin-reference-form" onSubmit={(event) => { event.preventDefault(); void addReference(event.currentTarget); }}><input className="admin-input" name="sourceUrl" type="url" required placeholder="https://www.linkedin.com/posts/..." /><textarea className="admin-textarea" name="notes" placeholder="O que vale estudar neste post? Gancho, estrutura, tom, CTA, formato visual…" /><button className="admin-button active" type="submit">Adicionar referência ao RAG</button></form>
      <div className="admin-reference-list">{references.length === 0 ? <p className="admin-meta">Nenhuma referência cadastrada.</p> : references.map((reference) => <div className="admin-reference" key={reference.id}><div><a href={reference.sourceUrl ?? undefined} target="_blank" rel="noreferrer">{reference.sourceUrl ?? "Referência"}</a><p>{reference.content}</p><small>{formatDate(reference.createdAt)}</small></div><button className="admin-button" onClick={() => void removeReference(reference.id)}>Remover</button></div>)}</div>
    </section>
  </div></main>;
}
