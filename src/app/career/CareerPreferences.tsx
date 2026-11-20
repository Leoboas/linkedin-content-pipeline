"use client";

import { FormEvent, useEffect, useState } from "react";

type Preferences = { targetTitles: string[]; locations: string[]; minimumMatchScore: number; remoteOnly: boolean; autoApplyEnabled?: false };

export function CareerPreferences({ token }: { token: string }) {
  const [value, setValue] = useState<Preferences>({ targetTitles: [], locations: ["Brasil", "United States", "Europe", "Remote"], minimumMatchScore: 70, remoteOnly: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  useEffect(() => {
    let active = true;
    void fetch("/api/career/preferences", { headers, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Preferências de busca indisponíveis.");
      const data = await response.json() as Preferences;
      if (active) setValue(data);
    }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "Falha ao carregar filtros."); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const targetTitles = String(form.get("titles") ?? "").split(/\n|,/).map((item) => item.trim()).filter(Boolean);
    const locations = String(form.get("locations") ?? "").split(/\n|,/).map((item) => item.trim()).filter(Boolean);
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/career/preferences", { method: "PUT", headers, body: JSON.stringify({ targetTitles, locations, minimumMatchScore: Number(form.get("minimumMatchScore")), remoteOnly: form.get("remoteOnly") === "on" }) });
      const payload = await response.json() as Preferences & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível salvar os filtros.");
      setValue(payload); setMessage("Filtros salvos e usados na próxima busca.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao salvar filtros."); }
    finally { setBusy(false); }
  }

  return <section className="admin-panel career-preferences">
    <div className="admin-section-heading"><div><div className="admin-kicker">Preferências de busca</div><h2>Defina sua próxima oportunidade</h2><p className="admin-subtitle">Os cargos e locais abaixo são persistidos e usados pelo scanner autorizado. A aplicação externa continua sob sua confirmação.</p></div></div>
    <form key={`${value.targetTitles.join("|")}:${value.locations.join("|")}:${value.minimumMatchScore}:${value.remoteOnly}`} className="career-preference-grid" onSubmit={(event) => void save(event)}>
      <label className="admin-label">Cargos-alvo<textarea className="admin-textarea" name="titles" defaultValue={value.targetTitles.join("\n")} placeholder="Python Backend Engineer&#10;Data Engineer&#10;Tech Lead" rows={5} /></label>
      <label className="admin-label">Países, regiões ou localidades<textarea className="admin-textarea" name="locations" defaultValue={value.locations.join("\n")} placeholder="Brasil&#10;Portugal&#10;Remote" rows={5} /></label>
      <div className="career-preference-options"><label className="admin-label">Match mínimo (%)<input className="admin-input" name="minimumMatchScore" type="number" min="0" max="100" defaultValue={value.minimumMatchScore} /></label><label className="admin-check"><input name="remoteOnly" type="checkbox" defaultChecked={value.remoteOnly} /> Somente remoto</label><div className="career-safety-note">Envio automático de candidaturas desativado. Você revisa a vaga e confirma cada envio no site de origem.</div><button className="admin-button active" type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar preferências"}</button>{message && <p className="admin-meta" role="status">{message}</p>}</div>
    </form>
  </section>;
}
