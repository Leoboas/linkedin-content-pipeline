import assert from "node:assert/strict";
import { buildApplicationKitDocx, buildApplicationKitPdf, kitFilenameStem } from "../src/lib/career-application-kit-documents.ts";

async function main() {
  const sample = {
    language: "PT_BR" as const,
    jobTitle: "Engenheiro de Dados",
    company: "Empresa Sintetica",
    version: 2,
    coverLetter: "Carta de teste com dados sintéticos. O conteúdo foi preparado para revisão humana e não representa candidatura enviada.",
    tailoredResume: {
      headline: "Engenheiro de Dados | Python | AWS",
      summary: "Profissional com experiência documentada em engenharia de dados.",
      skills: [{ category: "Competências", items: ["Python", "Amazon Web Services (AWS)"] }],
      experience: [{ role: "Data Engineer", company: "Empresa Sintetica", period: "2023-2025", bullets: ["Construção de pipelines de dados em Python."] }],
      projects: [{ name: "Projeto Sintético", description: "Demonstração de processamento de dados.", stack: ["Python"] }],
      education: ["Graduação sintética"],
      languages: ["Português"],
    },
  };
  const [docx, pdf] = await Promise.all([buildApplicationKitDocx(sample), buildApplicationKitPdf(sample)]);
  assert.equal(docx.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  for (const part of ["resume", "cover"] as const) {
    const first = await buildApplicationKitPdf(sample, part);
    const second = await buildApplicationKitPdf(sample, part);
    assert.deepEqual(first, second, `${part} PDF preview must match the frozen attachment`);
  }
  assert.match(kitFilenameStem(sample.jobTitle, sample.version), /engenheiro-de-dados-application-kit-v2/u);
  console.log("application kit document acceptance: synthetic DOCX/PDF export and versioned filename passed.");
}

void main();
