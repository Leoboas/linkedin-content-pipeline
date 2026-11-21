"use client";

import { useEffect, useState } from "react";

type ResumeFile = { id: string; resumeKey: string; originalName: string; profileType: string; language: string; version: string; sha256: string; byteSize: number; updatedAt: string };
const authorizedFiles = [
  { name: "Leonardo_Villas_Boas_Engenheiro_Dados_PTBR_V2(1).docx", title: "Data Engineering · Português (Brasil)" },
  { name: "Leonardo_Villas_Boas_Data_Engineer_EN_V2(1).docx", title: "Data Engineer · English" },
  { name: "Leonardo_Villas_Boas_Python_Backend_EN_V2(1).docx", title: "Python Backend · English" },
  { name: "Leonardo_Villas_Boas_Backend_Python_PTBR_V2(1).docx", title: "Python Backend · Português (Brasil)" },
];

export function ResumeBuilder({ token }: { token: string; matches?: Array<{ id: string; title: string; score: number }> }) {
  const [resumes, setResumes] = useState<ResumeFile[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  async function load() {
    const response = await fetch("/api/career/resumes/library", { headers, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar a biblioteca.");
    setResumes(payload.resumes ?? []);
  }

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Biblioteca não disponível.")); }, []);

  async function importFile(file: File | undefined, expectedName: string) {
    if (!file) return;
    if (file.name !== expectedName) { setMessage("Selecione o arquivo autorizado com o nome exato exibido na lista."); return; }
    setBusy(true); setMessage("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/career/resumes/library", { method: "POST", headers, body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao importar documento.");
      await load(); setMessage(`${file.name} importado com hash SHA-256 verificado.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao importar currículo."); }
    finally { setBusy(false); }
  }

  async function download(resume: ResumeFile) {
    const response = await fetch(`/api/career/resumes/library/${resume.id}`, { headers, cache: "no-store" });
    if (!response.ok) { setMessage("Não foi possível baixar o documento privado."); return; }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = resume.originalName; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section id="resume-builder" className="admin-panel">
    <div className="admin-section-heading"><div><div className="admin-kicker">Biblioteca privada de currículos</div><h2>Os quatro documentos autorizados</h2><p className="admin-subtitle">O sistema não gera nem altera currículos. Os DOCX são armazenados no banco privado; importação restrita aos nomes autorizados e download protegido pela sessão.</p></div></div>
    {message && <p className="admin-meta" role="status">{message}</p>}
    <div className="admin-list">{authorizedFiles.map((item) => {
      const imported = resumes.find((resume) => resume.originalName === item.name);
      return <article className="admin-card" key={item.name}>
        <div className="admin-card-head"><div><strong>{item.title}</strong><div className="admin-meta">{item.name}</div></div><span className="admin-status">{imported ? "Importado" : "Pendente"}</span></div>
        {imported ? <><p className="admin-meta">Versão {imported.version} · SHA-256 {imported.sha256} · atualizado {new Date(imported.updatedAt).toLocaleString("pt-BR")}</p><button className="admin-button" disabled={busy} onClick={() => void download(imported)}>Baixar original privado</button></> : <label className="admin-button">Importar documento autorizado<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} hidden onChange={(event) => void importFile(event.currentTarget.files?.[0], item.name)} /></label>}
      </article>;
    })}</div>
    {resumes.length < 4 && <p className="admin-meta">Seleção automática de CV e preparação de candidatura ficam bloqueadas até importar os quatro arquivos autorizados. A importação é manual; nenhum arquivo é lido de outras pastas ou enviado a empregadores.</p>}
  </section>;
}
