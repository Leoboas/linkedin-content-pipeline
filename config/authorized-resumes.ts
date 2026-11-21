import type { AuthorizedResumeLanguage, AuthorizedResumeProfile } from "@prisma/client";

export const AUTHORIZED_RESUMES = {
  dataEngineeringPtBr: {
    resumeKey: "data-engineering-pt-br-v2",
    originalName: "Leonardo_Villas_Boas_Engenheiro_Dados_PTBR_V2(1).docx",
    profileType: "DATA_ENGINEERING",
    language: "PT_BR",
    version: "V2",
    title: "Data Engineering · Português (Brasil)",
  },
  dataEngineeringEn: {
    resumeKey: "data-engineering-en-v2",
    originalName: "Leonardo_Villas_Boas_Data_Engineer_EN_V2(1).docx",
    profileType: "DATA_ENGINEERING",
    language: "EN",
    version: "V2",
    title: "Data Engineer · English",
  },
  pythonBackendEn: {
    resumeKey: "python-backend-en-v2",
    originalName: "Leonardo_Villas_Boas_Python_Backend_EN_V2(1).docx",
    profileType: "PYTHON_BACKEND",
    language: "EN",
    version: "V2",
    title: "Python Backend · English",
  },
  pythonBackendPtBr: {
    resumeKey: "python-backend-pt-br-v2",
    originalName: "Leonardo_Villas_Boas_Backend_Python_PTBR_V2(1).docx",
    profileType: "PYTHON_BACKEND",
    language: "PT_BR",
    version: "V2",
    title: "Python Backend · Português (Brasil)",
  },
} as const satisfies Record<string, {
  resumeKey: string;
  originalName: string;
  profileType: AuthorizedResumeProfile;
  language: AuthorizedResumeLanguage;
  version: string;
  title: string;
}>;

export type AuthorizedResumeKey = (typeof AUTHORIZED_RESUMES)[keyof typeof AUTHORIZED_RESUMES]["resumeKey"];

export function getResumeMetadataByName(name: string) {
  return Object.values(AUTHORIZED_RESUMES).find((resume) => resume.originalName === name) ?? null;
}

export function recommendAuthorizedResume(input: { title: string; description: string; languageHint?: string }) {
  const text = `${input.title} ${input.description}`.toLocaleLowerCase("en-US");
  const isData = /data engineer|data engineering|data platform|analytics engineer|etl|elt|pyspark|apache spark|data pipeline/.test(text);
  const isBackend = /python backend|backend engineer|back-end|software engineer|api engineer|fastapi|django/.test(text);
  const language: "EN" | "PT_BR" = input.languageHint === "PT_BR" ? "PT_BR" : "EN";
  if (isData) {
    return { resumeKey: language === "PT_BR" ? AUTHORIZED_RESUMES.dataEngineeringPtBr.resumeKey : AUTHORIZED_RESUMES.dataEngineeringEn.resumeKey, profileType: "DATA_ENGINEERING" as const, language, reason: "Perfil de Data Engineering selecionado pelo cargo e requisitos identificados; idioma presumido pelo mercado/texto da vaga." };
  }
  if (isBackend) {
    return { resumeKey: language === "PT_BR" ? AUTHORIZED_RESUMES.pythonBackendPtBr.resumeKey : AUTHORIZED_RESUMES.pythonBackendEn.resumeKey, profileType: "PYTHON_BACKEND" as const, language, reason: "Perfil de Python Backend selecionado pelo cargo e requisitos identificados; idioma presumido pelo mercado/texto da vaga." };
  }
  return null;
}
