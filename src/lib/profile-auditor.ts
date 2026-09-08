import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { auditLinkedInProfile as persistLinkedInAudit } from "@/lib/career-engine";
import { asStringArray, tokenize } from "@/lib/career-rag";
import { prisma } from "@/lib/prisma";

export interface ProfileAuditReport {
  score: number;
  strengths: string[];
  suggestedHeadlines: string[];
  seoKeywords: string[];
  aboutRewrite: string;
  recommendations: string[];
  jobHistoryCount: number;
  createdAt: string;
}

export async function loadBrandDossier(): Promise<string> {
  const filePath = join(process.cwd(), "data", "brand-dossier.md");
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Nao foi possivel ler data/brand-dossier.md: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function unique(values: string[], limit: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function dossierKeywords(dossier: string): string[] {
  const known = [
    "Python", "SQL", "PostgreSQL", "AWS", "Airflow", "Docker", "Data Lake",
    "ETL", "ELT", "Machine Learning", "ML", "GCP", "Azure", "dbt", "Kafka",
    "Terraform", "Kubernetes", "FinOps", "Analytics", "Engenharia de Dados",
  ];
  const lower = dossier.toLocaleLowerCase("pt-BR");
  return known.filter((keyword) => lower.includes(keyword.toLocaleLowerCase("pt-BR")));
}

function suggestedHeadlines(profile: { name: string; headline: string; targetTitles: Prisma.JsonValue; skills: Prisma.JsonValue }): string[] {
  const targets = asStringArray(profile.targetTitles);
  const skills = asStringArray(profile.skills);
  const primaryTarget = targets[0] ?? "Engenharia de Dados";
  const stack = skills.slice(0, 3).join(" | ") || "Dados | Cloud | Automacao";
  return unique([
    `${primaryTarget} | ${stack} | Transformo dados em decisoes operacionais`,
    `${primaryTarget} com foco em arquitetura, confiabilidade e resultado de negocio`,
    `${profile.headline} | ${stack}`,
  ], 3);
}

function aboutRewrite(profile: { name: string; headline: string; about: string; targetTitles: Prisma.JsonValue; skills: Prisma.JsonValue }, dossier: string): string {
  const skills = unique([...asStringArray(profile.skills), ...dossierKeywords(dossier)], 8);
  const targets = asStringArray(profile.targetTitles);
  const focus = targets.slice(0, 3).join(", ") || "engenharia de dados e tecnologia";
  const stack = skills.join(", ") || "Python, SQL e cloud";
  return [
    `Sou ${profile.name}, ${profile.headline}. Trabalho na interseção entre engenharia, dados e operação de negócio.`,
    `Meu foco é construir soluções confiáveis para ${focus}, com decisões técnicas orientadas por impacto e custo.`,
    `Atuo com ${stack}. Gosto de transformar problemas ambíguos em pipelines observáveis, processos simples de operar e resultados que o time consegue medir.`,
    `Neste perfil compartilho aprendizados de arquitetura, automação, qualidade de dados e liderança técnica.`,
  ].join("\n\n").slice(0, 2_000);
}

export async function auditLinkedInProfile(): Promise<ProfileAuditReport> {
  const dossier = await loadBrandDossier();
  const persisted = await persistLinkedInAudit();
  const profile = await prisma.candidateProfile.findUnique({ where: { id: persisted.profileId } });
  if (!profile) throw new Error("Perfil usado na auditoria nao foi encontrado apos o registro da auditoria.");

  const history = await prisma.jobMatch.findMany({
    where: { profileId: profile.id },
    include: { job: { select: { title: true, description: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const historyTerms = history.flatMap((match) => tokenize(`${match.job.title} ${match.job.description}`));
  const keywords = unique([
    ...asStringArray(profile.skills),
    ...dossierKeywords(dossier),
    ...historyTerms.filter((term) => term.length >= 4),
  ], 20);
  const recommendations = asStringArray(persisted.recommendations);
  const strengths = asStringArray(persisted.strengths);

  return {
    score: persisted.score,
    strengths,
    suggestedHeadlines: suggestedHeadlines(profile),
    seoKeywords: keywords,
    aboutRewrite: aboutRewrite(profile, dossier),
    recommendations: unique([
      ...recommendations,
      "Revisar o headline a cada mudanca relevante de foco ou cargo-alvo.",
      "Publicar cases com contexto, decisao tecnica e resultado verificavel.",
    ], 8),
    jobHistoryCount: history.length,
    createdAt: persisted.createdAt.toISOString(),
  };
}
