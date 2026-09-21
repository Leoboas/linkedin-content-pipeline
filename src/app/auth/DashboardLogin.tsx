"use client";

import { FormEvent, useState } from "react";

export function DashboardLogin({ nextPath }: { nextPath: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível entrar.");
      window.location.assign(nextPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao autenticar.");
    } finally { setBusy(false); }
  }

  return <main className="admin-shell"><div className="admin-container"><section className="admin-panel admin-login-panel"><div className="admin-kicker">Área protegida</div><h1 className="admin-title">Career Engine</h1><p className="admin-subtitle">Entre para gerenciar posts, currículos, vagas e métricas.</p><form className="admin-edit" onSubmit={(event) => void submit(event)}><input className="admin-input" autoComplete="username" placeholder="Usuário" value={username} onChange={(event) => setUsername(event.target.value)} required /><input className="admin-input" type="password" autoComplete="current-password" placeholder="Senha" value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="admin-button active" type="submit" disabled={busy}>{busy ? "Entrando..." : "Entrar"}</button></form>{error && <p className="admin-error" role="alert">{error}</p>}</section></div></main>;
}
