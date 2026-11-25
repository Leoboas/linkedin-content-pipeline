import type { AuthorizedResumeLanguage, AuthorizedResumeProfile } from "@prisma/client";

export const AUTHORIZED_RESUMES = {
  dataEngineeringPtBr: {
    resumeKey: "data-engineering-pt-br-v2",
    originalName: "Leonardo_Villas_Boas_Engenheiro_Dados_PTBR_V2.docx",
    profileType: "DATA_ENGINEERING",
    language: "PT_BR",
    version: "V2",
    title: "Data Engineering · Português (Brasil)",
    referenceOnly: false,
  },
  dataEngineeringEn: {
    resumeKey: "data-engineering-en-v2",
    originalName: "Leonardo_Villas_Boas_Data_Engineer_EN_V2.docx",
    profileType: "DATA_ENGINEERING",
    language: "EN",
    version: "V2",
    title: "Data Engineer · English",
    referenceOnly: false,
  },
  pythonBackendEn: {
    resumeKey: "python-backend-en-v2",
    originalName: "Leonardo_Villas_Boas_Python_Backend_EN_V2.docx",
    profileType: "PYTHON_BACKEND",
    language: "EN",
    version: "V2",
    title: "Python Backend · English",
    referenceOnly: false,
  },
  pythonBackendPtBr: {
    resumeKey: "python-backend-pt-br-v2",
    originalName: "Leonardo_Villas_Boas_Backend_Python_PTBR_V2.docx",
    profileType: "PYTHON_BACKEND",
    language: "PT_BR",
    version: "V2",
    title: "Python Backend · Português (Brasil)",
    referenceOnly: false,
  },
  historicalTechPtBr: {
    resumeKey: "reference-tech-pt-br-pdf",
    originalName: "CV_Leonardo_Villas_Boas_Tech.pdf",
    profileType: "PYTHON_BACKEND",
    language: "PT_BR",
    version: "HISTORICAL_PDF",
    title: "Currículo técnico anterior · referência",
    referenceOnly: true,
  },
  historicalTechEn: {
    resumeKey: "reference-tech-en-pdf",
    originalName: "Leonardo_Villas_Boas_Resume_EN_TECH.pdf",
    profileType: "DATA_ENGINEERING",
    language: "EN",
    version: "HISTORICAL_PDF",
    title: "Previous English technical resume · reference",
    referenceOnly: true,
  },
} as const satisfies Record<string, {
  resumeKey: string;
  originalName: string;
  profileType: AuthorizedResumeProfile;
  language: AuthorizedResumeLanguage;
  version: string;
  title: string;
  referenceOnly: boolean;
}>;

export type AuthorizedResumeKey = (typeof AUTHORIZED_RESUMES)[keyof typeof AUTHORIZED_RESUMES]["resumeKey"];

export function getResumeMetadataByName(name: string) {
  const canonicalName = name.replace(/\s*\(\d+\)(?=\.[^.]+$)/u, "");
  return Object.values(AUTHORIZED_RESUMES).find((resume) => resume.originalName === canonicalName) ?? null;
}

export function recommendAuthorizedResume(input: { title: string; description: string; languageHint?: string }) {
  const text = `${input.title} ${input.description}`.toLocaleLowerCase("en-US");
  const isData = /data engineer|data engineering|data platform|analytics engineer|analytics lead|etl|elt|pyspark|apache spark|data pipeline|\bdata\b/.test(text);
  const isBackend = /python backend|backend engineer|back-end|\bbackend\b|software engineer|api engineer|fastapi|django|\bpython\b|full[ -]?stack/.test(text);
  const language: "EN" | "PT_BR" = input.languageHint === "PT_BR" ? "PT_BR" : "EN";
  if (isData) {
    return { resumeKey: language === "PT_BR" ? AUTHORIZED_RESUMES.dataEngineeringPtBr.resumeKey : AUTHORIZED_RESUMES.dataEngineeringEn.resumeKey, profileType: "DATA_ENGINEERING" as const, language, reason: "Perfil de Data Engineering selecionado pelo cargo e requisitos identificados; idioma presumido pelo mercado/texto da vaga." };
  }
  if (isBackend) {
    return { resumeKey: language === "PT_BR" ? AUTHORIZED_RESUMES.pythonBackendPtBr.resumeKey : AUTHORIZED_RESUMES.pythonBackendEn.resumeKey, profileType: "PYTHON_BACKEND" as const, language, reason: "Perfil de Python Backend selecionado pelo cargo e requisitos identificados; idioma presumido pelo mercado/texto da vaga." };
  }
  return null;
}
