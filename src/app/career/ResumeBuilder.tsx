"use client";

import { useEffect, useMemo, useState } from "react";

type ResumeFile = { id: string; resumeKey: string; originalName: string; profileType: string; language: string; version: string; sha256: string; byteSize: number; referenceOnly: boolean; createdAt: string; updatedAt: string };
const resumeSlots = [
  { key: "data-engineering-pt-br-v2", name: "Leonardo_Villas_Boas_Engenheiro_Dados_PTBR_V2.docx", title: "Data Engineer · Português (Brasil)", referenceOnly: false },
  { key: "data-engineering-en-v2", name: "Leonardo_Villas_Boas_Data_Engineer_EN_V2.docx", title: "Data Engineer · English", referenceOnly: false },
  { key: "python-backend-en-v2", name: "Leonardo_Villas_Boas_Python_Backend_EN_V2.docx", title: "Python Backend · English", referenceOnly: false },
  { key: "python-backend-pt-br-v2", name: "Leonardo_Villas_Boas_Backend_Python_PTBR_V2.docx", title: "Python Backend · Português (Brasil)", referenceOnly: false },
  { key: "reference-tech-pt-br-pdf", name: "CV_Leonardo_Villas_Boas_Tech.pdf", title: "Currículo técnico anterior · referência de versão que gerou entrevistas", referenceOnly: true },
  { key: "reference-tech-en-pdf", name: "Leonardo_Villas_Boas_Resume_EN_TECH.pdf", title: "Previous English technical resume · interview reference", referenceOnly: true },
];

export function ResumeBuilder({ token }: { token: string; matches?: Array<{ id: string; title: string; score: number }> }) {
  const [resumes, setResumes] = useState<ResumeFile[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const requiredSlots = resumeSlots.filter((slot) => !slot.referenceOnly);
  const importedRequired = useMemo(() => requiredSlots.filter((slot) => resumes.some((resume) => !resume.referenceOnly && (resume.resumeKey === slot.key || resume.resumeKey.startsWith(`${slot.key}-v`)))).length, [resumes]);

  async function load() {
    const response = await fetch("/api/career/resumes/library", { headers, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar a biblioteca.");
    setResumes(payload.resumes ?? []);
  }

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Biblioteca não disponível.")); }, []);

  async function importFile(file: File | undefined, slot: (typeof resumeSlots)[number]) {
    if (!file) return;
    if (file.name.replace(/\s*\(\d+\)(?=\.[^.]+$)/u, "") !== slot.name) { setMessage("Selecione o arquivo indicado neste cartão; o conteúdo não será enviado a empregadores."); return; }
    setBusy(true); setMessage("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/career/resumes/library", { method: "POST", headers, body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao importar documento.");
      await load();
      setMessage(payload.duplicate ? "Este mesmo arquivo já estava importado; nenhuma versão foi sobrescrita." : `${slot.referenceOnly ? "PDF de referência importado" : "Nova versão privada importada"}; o original foi preservado e o conteúdo foi extraído para consulta autenticada.`);
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
    <div className="admin-section-heading"><div><div className="admin-kicker">Biblioteca privada · currículo ATS</div><h2>Currículos autorizados e referências</h2><p className="admin-subtitle">Os quatro DOCX V2 são as bases atuais. Os dois PDFs antigos ficam identificados apenas como referências; eles não entram na recomendação automática. Arquivos são privados, versionados por hash e não são enviados a empregadores.</p></div></div>
    <p className="admin-meta">Bases principais importadas: {importedRequired}/4 · PDFs de referência: {resumes.filter((resume) => resume.referenceOnly).length}/2</p>
    {message && <p className="admin-meta" role="status">{message}</p>}
    <div className="admin-list">{resumeSlots.map((slot) => {
      const versions = resumes.filter((resume) => resume.resumeKey === slot.key || resume.resumeKey.startsWith(`${slot.key}-v`)).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
      return <article className="admin-card" key={slot.key}>
        <div className="admin-card-head"><div><strong>{slot.title}</strong><div className="admin-meta">{slot.name} {slot.referenceOnly && "· somente comparação editorial"}</div></div><span className="admin-status">{versions.length ? `${versions.length} versão(ões)` : "Pendente"}</span></div>
        {versions.map((resume, index) => <div className="admin-actions" key={resume.id}><span className="admin-meta">{index === 0 ? "Mais recente" : "Versão anterior"} · {resume.version} · SHA-256 {resume.sha256.slice(0, 12)}… · importado {new Date(resume.createdAt).toLocaleDateString("pt-BR")}</span><button className="admin-button" disabled={busy} onClick={() => void download(resume)}>Baixar original privado</button></div>)}
        <label className="admin-button">{versions.length ? "Importar nova versão sem sobrescrever" : "Importar arquivo"}<input type="file" accept={slot.name.endsWith(".pdf") ? ".pdf,application/pdf" : ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"} disabled={busy} hidden onChange={(event) => { void importFile(event.currentTarget.files?.[0], slot); event.currentTarget.value = ""; }} /></label>
      </article>;
    })}</div>
    {importedRequired < 4 && <p className="admin-meta">A recomendação de currículo e a preparação de materiais continuam bloqueadas até importar os quatro DOCX V2. PDFs de referência não contam como versões autorizadas para candidatura.</p>}
  </section>;
}
