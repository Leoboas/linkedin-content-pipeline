"use client";

import { useEffect, useState } from "react";

type ResumeDraft = {
  id: string;
  targetRole: string;
  template: string;
  status: string;
  atsScore: number;
  content: {
    headline?: string;
    summary?: string;
    skills?: Array<{ category: string; items: string[] }>;
    experience?: Array<{ role: string; company: string; period: string; bullets: string[] }>;
    projects?: Array<{ name: string; description: string; stack: string[] }>;
    education?: string[];
    languages?: string[];
  };
  validation?: { strengths?: string[]; warnings?: string[]; missingKeywords?: string[]; atsReady?: boolean };
  createdAt: string;
};

const templates = [
  ["ats-tech", "ATS Tech Lead"],
  ["ats-data", "ATS Data Engineering"],
  ["executive-growth", "Executivo Tech + Growth"],
];

export function ResumeBuilder({ token, matches }: { token: string; matches: Array<{ id: string; title: string; score: number }> }) {
  const [drafts, setDrafts] = useState<ResumeDraft[]>([]);
  const [targetRole, setTargetRole] = useState("Tech Lead (Data/Cloud)");
  const [template, setTemplate] = useState("ats-tech");
  const [jobId, setJobId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [selectedDraft, setSelectedDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadDrafts() {
    if (!token) return;
    const response = await fetch("/api/career/resumes", { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar os currículos.");
    setDrafts(payload.drafts ?? []);
  }

  useEffect(() => { void loadDrafts().catch((error) => setMessage(error instanceof Error ? error.message : "Falha ao carregar currículos.")); }, [token]);

  async function generate() {
    if (!token || !targetRole.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/career/resumes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ targetRole, template, jobId: jobId || undefined, feedback: feedback || undefined, draftId: selectedDraft || undefined, sourceText: sourceText || undefined }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível gerar o currículo.");
      setDrafts((current) => [payload, ...current]);
      setSelectedDraft(payload.id);
      setFeedback("");
      setSourceText("");
      setMessage("Nova versão criada para revisão: " + Math.round(payload.atsScore) + "/100.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao gerar currículo."); }
    finally { setBusy(false); }
  }

  return <section className="admin-panel">
    <div className="admin-section-heading"><div><div className="admin-kicker">Resume Builder</div><h2>Currículo direcionado por vaga</h2><p className="admin-subtitle">Cada geração cria uma versão para revisão. O motor combina o perfil, skills normalizadas e a descrição da vaga sem inventar experiências.</p></div></div>
    <div className="admin-edit">
      <input className="admin-input" value={targetRole} onChange={(event) => setTargetRole(event.target.value)} placeholder="Cargo-alvo" />
      <select className="admin-input" value={template} onChange={(event) => setTemplate(event.target.value)}>{templates.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      <select className="admin-input" value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Sem vaga específica</option>{matches.slice(0, 15).map((match) => <option key={match.id} value={match.id}>{match.title} · {Math.round(match.score)}/100</option>)}</select>
      <textarea className="admin-textarea" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Feedback de revisão: ex. enfatize Airflow e AWS, reduza Growth e preserve apenas métricas comprovadas." />
      <textarea className="admin-textarea" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Material adicional opcional: cole o texto do CV, da vaga ou de um projeto. Não inclua segredos." />
      <button className="admin-button active" disabled={busy || !token || !targetRole.trim()} onClick={() => void generate()}>{busy ? "Gerando..." : selectedDraft ? "Gerar nova revisão" : "Gerar currículo para revisão"}</button>
      {message && <p className="admin-meta">{message}</p>}
    </div>
    <div className="admin-list">{drafts.length === 0 ? <p className="admin-meta">Nenhum template gerado ainda.</p> : drafts.map((draft) => <article className="admin-card" key={draft.id}>
      <div className="admin-card-head"><div><strong>{draft.targetRole}</strong><div className="admin-meta">{draft.template} · {draft.status} · {new Date(draft.createdAt).toLocaleString("pt-BR")}</div></div><span className="admin-status">{Math.round(draft.atsScore)}/100</span></div>
      <p><strong>{draft.content.headline}</strong></p><p style={{ whiteSpace: "pre-wrap" }}>{draft.content.summary}</p>
      {draft.validation?.warnings?.length ? <p className="admin-meta">⚠️ {draft.validation.warnings.join(" · ")}</p> : <p className="admin-meta">✅ Pronto para revisão humana.</p>}
      {!!draft.content.skills?.length && <p className="admin-meta">Skills: {draft.content.skills.flatMap((group) => group.items).join(", ")}</p>}
      <button className="admin-button" onClick={() => { setSelectedDraft(draft.id); setTargetRole(draft.targetRole); setTemplate(draft.template); }}>Solicitar nova revisão</button>
    </article>)}</div>
  </section>;
}
