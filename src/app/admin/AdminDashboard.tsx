"use client";

import { useMemo, useState } from "react";

export interface DashboardPost {
  id: string;
  title: string;
  textContent: string;
  imagePrompt: string | null;
  editorialPillar: string;
  status: string;
  scheduledFor: string;
  scheduledDate: string;
  engagementScore: number | null;
  engagementLabel: string | null;
}

type View = "list" | "month" | "week";

const statusClass: Record<string, string> = { APPROVED: "approved", SCHEDULED: "scheduled", DRAFT: "draft", PUBLISHED: "published" };
const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function dateKey(value: string): string { return value.slice(0, 10); }
function formatDate(value: string): string { return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }

export function AdminDashboard({ initialPosts }: { initialPosts: DashboardPost[] }) {
  const [posts, setPosts] = useState(initialPosts);
  const [view, setView] = useState<View>("list");
  const [editing, setEditing] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [message, setMessage] = useState("");

  const visiblePosts = useMemo(() => posts.filter((post) => ["APPROVED", "SCHEDULED", "DRAFT", "PUBLISHED"].includes(post.status)), [posts]);
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

  async function save(post: DashboardPost, form: HTMLFormElement) {
    const data = new FormData(form);
    const scheduledDate = String(data.get("scheduledDate") ?? "");
    const response = await fetch(`/api/posts/${post.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ title: data.get("title"), textContent: data.get("textContent"), imagePrompt: data.get("imagePrompt"), scheduledDate: new Date(scheduledDate).toISOString() }),
    });
    if (!response.ok) { setMessage(await response.text()); return; }
    const updated = await response.json() as DashboardPost;
    setPosts((current) => current.map((item) => item.id === post.id ? { ...item, ...updated, scheduledFor: updated.scheduledFor, scheduledDate: updated.scheduledDate } : item));
    setEditing(null); setMessage("Alterações salvas.");
  }

  function eventsFor(day: string): DashboardPost[] { return visiblePosts.filter((post) => dateKey(post.scheduledDate) === day); }

  return <main className="admin-shell"><div className="admin-container">
    <header className="admin-header"><div><div className="admin-kicker">Autonomous LinkedIn Content Engine</div><h1 className="admin-title">Agenda editorial</h1><p className="admin-subtitle">Acompanhe aprovação, publicação e aprendizado de cada post.</p></div></header>
    <section className="admin-panel">
      <div className="admin-toolbar">
        {(["list", "month", "week"] as View[]).map((item) => <button key={item} className={`admin-button ${view === item ? "active" : ""}`} onClick={() => setView(item)}>{item === "list" ? "Timeline" : item === "month" ? "Calendário mensal" : "Semana atual"}</button>)}
        <input className="admin-input admin-token" type="password" placeholder="DASHBOARD_ADMIN_TOKEN (para editar)" value={token} onChange={(event) => setToken(event.target.value)} />
        {message && <span className="admin-meta">{message}</span>}
      </div>
      {view === "list" && <div className="admin-list">{visiblePosts.map((post) => <article className={`admin-card ${statusClass[post.status] ?? ""}`} key={post.id}>
        <div className="admin-card-head"><div><strong>{post.title}</strong><div className="admin-meta">{post.editorialPillar} · {formatDate(post.scheduledDate)} · {post.engagementScore === null ? "sem score" : `${Math.round(post.engagementScore)}/100 (${post.engagementLabel ?? ""})`}</div></div><span className="admin-status">{post.status}</span></div>
        {editing === post.id ? <form className="admin-edit" onSubmit={(event) => { event.preventDefault(); void save(post, event.currentTarget); }}><input className="admin-input" name="title" defaultValue={post.title} /><textarea className="admin-textarea" name="textContent" defaultValue={post.textContent} /><textarea className="admin-textarea" name="imagePrompt" placeholder="Prompt da imagem" defaultValue={post.imagePrompt ?? ""} /><input className="admin-input" name="scheduledDate" type="datetime-local" defaultValue={post.scheduledDate.slice(0, 16)} /><div className="admin-actions"><button className="admin-button active" type="submit">Salvar</button><button className="admin-button" type="button" onClick={() => setEditing(null)}>Cancelar</button></div></form> : <div className="admin-actions"><button className="admin-button" onClick={() => setEditing(post.id)}>Editar</button></div>}
      </article>)}</div>}
      {view === "month" && <><div className="admin-toolbar"><button className="admin-button" onClick={() => setMonth((value) => { const d = new Date(`${value}-01T00:00:00`); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })}>←</button><strong>{month}</strong><button className="admin-button" onClick={() => setMonth((value) => { const d = new Date(`${value}-01T00:00:00`); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 7); })}>→</button></div><div className="admin-grid">{weekdays.map((day) => <div className="admin-weekday" key={day}>{day}</div>)}{monthCells.map((day, index) => { const key = day === null ? `empty-${index}` : `${month}-${String(day).padStart(2, "0")}`; return <div className={`admin-day ${day === null ? "muted" : ""}`} key={key}><div className="admin-day-number">{day ?? ""}</div>{day !== null && eventsFor(key).map((post) => <div className={`admin-event ${statusClass[post.status] ?? ""}`} key={post.id}><strong>{post.editorialPillar} · {post.title}</strong>{post.status} · {formatDate(post.scheduledDate)}</div>)}</div>; })}</div></>}
      {view === "week" && <div className="admin-list">{Array.from({ length: 7 }, (_, index) => { const day = new Date(weekStart.getTime() + index * 86400000); const key = day.toISOString().slice(0, 10); return <section className="admin-card" key={key}><strong>{day.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</strong>{weekPosts.filter((post) => dateKey(post.scheduledDate) === key).map((post) => <div className={`admin-event ${statusClass[post.status] ?? ""}`} key={post.id}><strong>{post.title}</strong>{post.status} · {formatDate(post.scheduledDate)}</div>)}</section>; })}</div>}
    </section>
  </div></main>;
}
