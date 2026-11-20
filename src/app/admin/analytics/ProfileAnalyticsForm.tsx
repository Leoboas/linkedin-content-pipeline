"use client";

import { useState } from "react";

const fields = [
  ["PROFILE_VIEWS", "Visualizações do perfil"],
  ["FOLLOWERS", "Seguidores totais"],
  ["SEARCH_APPEARANCES", "Aparições em pesquisas"],
  ["IMPRESSIONS_IN_NETWORK", "Impressões dentro da rede"],
  ["IMPRESSIONS_IN_NETWORK_PERCENT", "% de impressões dentro da rede"],
  ["IMPRESSIONS_OUTSIDE_NETWORK", "Impressões fora da rede"],
  ["IMPRESSIONS_OUTSIDE_NETWORK_PERCENT", "% de impressões fora da rede"],
  ["MEMBERS_REACHED_IN_NETWORK", "Pessoas alcançadas dentro da rede"],
  ["MEMBERS_REACHED_OUTSIDE_NETWORK", "Pessoas alcançadas fora da rede"],
] as const;

export function ProfileAnalyticsForm() {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const start = String(data.get("periodStart") ?? "");
    const end = String(data.get("periodEnd") ?? "");
    const metrics = fields.flatMap(([metricType]) => {
      const value = String(data.get(metricType) ?? "").trim();
      return value ? [{ metricType, value, periodStart: start || null, periodEnd: end || null }] : [];
    });
    if (metrics.length === 0) { setNotice("Preencha pelo menos um dado observado."); return; }

    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/profile-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics, sourceNote: String(data.get("sourceNote") ?? "").trim() }),
      });
      const result = await response.json() as { saved?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? `Falha HTTP ${response.status}`);
      form.reset();
      setNotice(`${result.saved ?? metrics.length} métrica(s) importada(s). A origem e o período foram preservados.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao importar métricas.");
    } finally { setSaving(false); }
  }

  return <section className="admin-panel"><h2>Importação manual e histórica</h2><p className="admin-subtitle">Percentuais, impressões absolutas e pessoas alcançadas são indicadores separados. Não derive um a partir do outro.</p><form className="admin-edit" onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
    <label className="admin-label">Período inicial<input className="admin-input" type="date" name="periodStart" /></label>
    <label className="admin-label">Data de referência / fim<input className="admin-input" type="date" name="periodEnd" /></label>
    {fields.map(([type, label]) => <label className="admin-label" key={type}>{label}<input className="admin-input" name={type} type="number" min="0" max={type.endsWith("_PERCENT") ? 100 : undefined} step="1" /></label>)}
    <label className="admin-label">Fonte da observação<input className="admin-input" name="sourceNote" required defaultValue="LinkedIn Analytics UI" /></label>
    <button className="admin-button active" type="submit" disabled={saving}>{saving ? "Importando…" : "Importar observações"}</button>
  </form>{notice && <p role="status" className="admin-meta">{notice}</p>}</section>;
}
