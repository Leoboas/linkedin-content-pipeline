"use client";

import { useState } from "react";

export interface CareerDashboardData {
  profile: { id: string; name: string; headline: string; about: string; location: string | null; linkedinUrl: string | null; skills: string[]; targetTitles: string[] } | null;
  matches: Array<{ id: string; title: string; company: string | null; location: string | null; url: string; score: number; label: string; matchedSkills: string[]; skillGaps: string[]; rationale: string }>;
  radar: Array<{ skill: string; category: string; demandCount: number; candidateLevel: number | null; gapScore: number }>;
  audit: { score: number; strengths: string[]; recommendations: string[]; createdAt: string; gaps?: string[]; recruiterVerdict?: string; marketPositioning?: string; suggestedHeadlines?: string[]; seoKeywords?: string[]; aboutRewrite?: string; roleFit?: Array<{ role: string; fitScore: number; reason: string }> } | null;
}

type Toast = { text: string; kind: "success" | "error" };

export function CareerDashboard({ initialData }: { initialData: CareerDashboardData }) {
  const [data, setData] = useState(initialData);
  const [token, setToken] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);

  function notify(text: string, kind: Toast["kind"] = "success") { setToast({ text, kind }); window.setTimeout(() => setToast(null), 5000); }
  function headers(): HeadersInit { return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }; }

  async function loadDashboard() {
    setBusy(true);
    try {
      const [profileResponse, matchesResponse] = await Promise.all([
        fetch("/api/career/profile", { headers: headers(), cache: "no-store" }),
        fetch("/api/career/matches", { headers: headers(), cache: "no-store" }),
      ]);
      const profile = await profileResponse.json();
      const payload = await matchesResponse.json();
      if (!profileResponse.ok || !matchesResponse.ok) throw new Error(profile.error ?? payload.error ?? "Não foi possível carregar o radar.");
      setData((current) => ({ ...current, profile: profile ? { id: profile.id, name: profile.name, headline: profile.headline, about: profile.about, location: profile.location, linkedinUrl: profile.linkedinUrl, skills: Array.isArray(profile.skills) ? profile.skills : [], targetTitles: Array.isArray(profile.targetTitles) ? profile.targetTitles : [] } : null, matches: (payload.matches ?? []).map((match: Record<string, unknown>) => { const job = match.job as Record<string, unknown>; return { id: String(match.id), title: String(job.title), company: (job.company as string | null) ?? null, location: (job.location as string | null) ?? null, url: String(job.url), score: Number(match.score), label: String(match.label), matchedSkills: Array.isArray(match.matchedSkills) ? match.matchedSkills as string[] : [], skillGaps: Array.isArray(match.skillGaps) ? match.skillGaps as string[] : [], rationale: String(match.rationale) }; }), radar: payload.radar ?? [], audit: current.audit }));
      notify("Dados do Career Engine carregados.");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao carregar o radar.", "error"); }
    finally { setBusy(false); }
  }

  async function saveProfile(form: HTMLFormElement) {
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") ?? ""), headline: String(formData.get("headline") ?? ""), about: String(formData.get("about") ?? ""),
      location: String(formData.get("location") ?? ""), linkedinUrl: String(formData.get("linkedinUrl") ?? ""),
      skills: String(formData.get("skills") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      targetTitles: String(formData.get("targetTitles") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    };
    setBusy(true);
    try {
      const response = await fetch("/api/career/profile", { method: "PUT", headers: headers(), body: JSON.stringify(payload) });
      const profile = await response.json();
      if (!response.ok) throw new Error(profile.error ?? "Não foi possível salvar o perfil.");
      setData((current) => ({ ...current, profile }));
      notify("Perfil profissional salvo.");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao salvar perfil.", "error"); }
    finally { setBusy(false); }
  }

  async function scan() {
    setBusy(true);
    try {
      const response = await fetch("/api/career/scan", { method: "POST", headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível iniciar a busca.");
      notify("Busca iniciada no Inngest. O Telegram receberá o resumo quando terminar.");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao iniciar busca.", "error"); }
    finally { setBusy(false); }
  }

  async function audit() {
    setBusy(true);
    try {
      const response = await fetch("/api/career/seo", { method: "POST", headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível auditar o perfil.");
      setData((current) => ({ ...current, audit: { score: payload.score, strengths: payload.strengths, recommendations: payload.recommendations, createdAt: payload.createdAt } }));
      setData((current) => ({ ...current, audit: { ...current.audit, ...payload } }));
      notify("Auditoria SEO atualizada.");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha na auditoria.", "error"); }
    finally { setBusy(false); }
  }

  const profile = data.profile;
  return <main className="admin-shell"><div className="admin-container">
    {toast && <div className={`admin-toast ${toast.kind}`} role="status">{toast.text}</div>}
    <header className="admin-header"><div><div className="admin-kicker">Job Hunter &amp; Career Engine</div><h1 className="admin-title">Radar de carreira</h1><p className="admin-subtitle">Busca autorizada, match de vagas, gaps de habilidades e SEO do LinkedIn.</p></div></header>
    <section className="admin-panel"><div className="admin-toolbar"><input className="admin-input admin-token" type="password" placeholder="DASHBOARD_ADMIN_TOKEN" value={token} onChange={(event) => setToken(event.target.value)} /><button className="admin-button" disabled={busy || !token} onClick={() => void loadDashboard()}>Carregar dados</button><button className="admin-button active" disabled={busy || !token} onClick={() => void scan()}>Buscar vagas agora</button><button className="admin-button" disabled={busy || !token} onClick={() => void audit()}>Auditar LinkedIn</button></div></section>
    <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Perfil RAG</div><h2>Perfil profissional</h2><p className="admin-subtitle">Esse contexto é usado para calcular aderência e gaps. Evite inserir dados sensíveis que não sejam necessários.</p></div></div>
      <form className="admin-edit" onSubmit={(event) => { event.preventDefault(); void saveProfile(event.currentTarget); }}>
        <input className="admin-input" name="name" required placeholder="Nome" defaultValue={profile?.name ?? ""} /><input className="admin-input" name="headline" required placeholder="Headline do LinkedIn" defaultValue={profile?.headline ?? ""} /><textarea className="admin-textarea" name="about" required placeholder="Resumo profissional" defaultValue={profile?.about ?? ""} /><input className="admin-input" name="location" placeholder="Localização" defaultValue={profile?.location ?? ""} /><input className="admin-input" name="linkedinUrl" type="url" placeholder="URL do LinkedIn" defaultValue={profile?.linkedinUrl ?? ""} /><input className="admin-input" name="skills" placeholder="Competências separadas por vírgula" defaultValue={profile?.skills.join(", ") ?? ""} /><input className="admin-input" name="targetTitles" placeholder="Cargos-alvo separados por vírgula" defaultValue={profile?.targetTitles.join(", ") ?? ""} /><button className="admin-button active" disabled={busy} type="submit">Salvar perfil</button>
      </form>
    </section>
    <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Matchmaker</div><h2>Vagas com maior aderência</h2></div></div><div className="admin-list">{data.matches.length === 0 ? <p className="admin-meta">Nenhuma vaga encontrada. Configure um feed JSON autorizado em LINKEDIN_JOBS_FEED_URL.</p> : data.matches.map((match) => <article className="admin-card" key={match.id}><div className="admin-card-head"><div><strong>{match.title}</strong><div className="admin-meta">{match.company ?? "Empresa não informada"} · {match.location ?? "Local não informado"}</div></div><span className="admin-status">{Math.round(match.score)}/100 · {match.label}</span></div><p>{match.rationale}</p><p className="admin-meta">Competências: {match.matchedSkills.join(", ") || "nenhuma"} · Gaps: {match.skillGaps.join(", ") || "nenhum detectado"}</p><a href={match.url} target="_blank" rel="noreferrer">Abrir vaga</a></article>)}</div></section>
    <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Skill Radar</div><h2>Competências demandadas</h2></div></div><div className="admin-list">{data.radar.slice(0, 12).map((item) => <div className="admin-card" key={`${item.category}-${item.skill}`}><strong>{item.skill}</strong><span className="admin-meta">Demanda: {item.demandCount} · Gap: {Math.round(item.gapScore)}/100</span></div>)}</div></section>
    <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">SEO LinkedIn</div><h2>Auditoria do perfil</h2></div></div>{data.audit ? <><div className="admin-card"><strong>Nota: {Math.round(data.audit.score)}/100</strong><p>{data.audit.strengths.join(" · ")}</p></div><ul>{data.audit.recommendations.map((item) => <li key={item}>{item}</li>)}</ul></> : <p className="admin-meta">Clique em “Auditar LinkedIn” para gerar a primeira análise.</p>}</section>
    {data.audit?.recruiterVerdict && <section className="admin-panel"><div className="admin-section-heading"><div><div className="admin-kicker">Recruiter + ATS</div><h2>Análise de posicionamento de mercado</h2></div></div><p><strong>Veredito:</strong> {data.audit.recruiterVerdict}</p><p><strong>Posicionamento:</strong> {data.audit.marketPositioning}</p>{data.audit.roleFit && <div className="admin-list">{data.audit.roleFit.map((item) => <div className="admin-card" key={item.role}><strong>{item.role} — {Math.round(item.fitScore)}/100</strong><p>{item.reason}</p></div>)}</div>}<p><strong>Gaps:</strong> {data.audit.gaps?.join(", ") || "Nenhum gap crítico identificado pela análise."}</p><p><strong>Palavras-chave SEO:</strong> {data.audit.seoKeywords?.join(", ")}</p><h3>Headlines sugeridas</h3><ul>{data.audit.suggestedHeadlines?.map((item) => <li key={item}>{item}</li>)}</ul><h3>Sobre recomendado</h3><p className="admin-meta" style={{ whiteSpace: "pre-wrap" }}>{data.audit.aboutRewrite}</p></section>}
  </div></main>;
}
