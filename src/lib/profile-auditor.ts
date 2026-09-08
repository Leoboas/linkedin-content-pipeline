import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { auditLinkedInProfile as persistLinkedInAudit } from "@/lib/career-engine";
import { generateTextWithFallback } from "@/lib/ai-provider";
import { asStringArray, tokenize } from "@/lib/career-rag";
import { prisma } from "@/lib/prisma";

export interface ProfileAuditReport {
  score: number;
  strengths: string[];
  gaps: string[];
  recruiterVerdict: string;
  marketPositioning: string;
  roleFit: Array<{ role: string; fitScore: number; reason: string }>;
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

function parseJsonResponse(value: string): Record<string, unknown> {
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned) as Record<string, unknown>; }
  catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Resposta da auditoria de mercado não é JSON válido.");
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function clampScore(value: unknown, fallback: number): number {
  const score = typeof value === "number" ? value : Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : fallback;
}

function deterministicMarketScore(profile: { headline: string; about: string; skills: Prisma.JsonValue; targetTitles: Prisma.JsonValue }): number {
  const skills = asStringArray(profile.skills);
  const targets = asStringArray(profile.targetTitles);
  const hasEvidence = /\d|%|R\$|resultado|crescimento|redução|aumento/i.test(profile.about);
  return Math.min(100,
    (profile.headline.length >= 60 ? 20 : 10)
    + (profile.about.length >= 600 ? 20 : profile.about.length >= 300 ? 12 : 5)
    + Math.min(25, skills.length * 2)
    + (targets.length >= 3 ? 15 : targets.length * 4)
    + (hasEvidence ? 20 : 5),
  );
}

async function generateMarketAudit(input: {
  profile: { name: string; headline: string; about: string; skills: Prisma.JsonValue; targetTitles: Prisma.JsonValue };
  dossier: string;
  history: Array<{ title: string; score: number; skillGaps: string[] }>;
}): Promise<Record<string, unknown> | null> {
  const completion = await generateTextWithFallback({
    model: process.env.PROFILE_AUDIT_MODEL || "mistralai/Mistral-7B-Instruct-v0.3",
    temperature: 0.2,
    max_tokens: 2600,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "Você é uma Tech Recruiter Executiva e especialista em ATS, SEO de LinkedIn e posicionamento para liderança de Dados, MarTech e Tecnologia.",
          "Faça uma auditoria crítica de mercado, não uma validação de preenchimento.",
          "Compare o perfil com os cargos-alvo e diga o que aumenta ou reduz a chance de aparecer em buscas e avançar para entrevista.",
          "Avalie clareza de senioridade, diferenciação, evidências, palavras-chave, coerência entre headline e Sobre, riscos de generalismo e gaps de mercado.",
          "Responda em português do Brasil, com linguagem de recrutadora sênior, direta e específica.",
          "Não invente empresas, métricas, certificações, cargos ou experiências. Diferencie evidência fornecida de recomendação.",
          "Em aboutRewrite, reutilize somente fatos, tecnologias e resultados explicitamente presentes no perfil ou no dossiê; não crie sinônimos que mudem o significado nem resultados implícitos.",
          "Responda exclusivamente JSON: {score,recruiterVerdict,marketPositioning,roleFit:[{role,fitScore,reason}],strengths,gaps,suggestedHeadlines,seoKeywords,aboutRewrite,recommendations}.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          profile: { name: input.profile.name, headline: input.profile.headline, about: input.profile.about, skills: asStringArray(input.profile.skills), targetTitles: asStringArray(input.profile.targetTitles) },
          dossier: input.dossier.slice(0, 8_000),
          recentJobHistory: input.history,
        }),
      },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("A IA de auditoria retornou resposta vazia.");
  return parseJsonResponse(content);
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
  const baseScore = deterministicMarketScore(profile);
  let ai: Record<string, unknown> | null = null;
  try {
    ai = await generateMarketAudit({
      profile,
      dossier,
      history: history.map((match) => ({ title: match.job.title, score: match.score, skillGaps: asStringArray(match.skillGaps) })),
    });
  } catch (error) {
    console.warn("[profile-auditor] IA de mercado indisponível; usando análise determinística", error instanceof Error ? error.message : String(error));
  }
  const fallbackRoles = asStringArray(profile.targetTitles).slice(0, 8).map((role) => ({ role, fitScore: baseScore, reason: "Compatibilidade estimada pela combinação de senioridade, competências e evidências cadastradas." }));
  const roleFit = Array.isArray(ai?.roleFit)
    ? ai.roleFit.flatMap((item): Array<{ role: string; fitScore: number; reason: string }> => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      if (typeof value.role !== "string" || typeof value.reason !== "string") return [];
      return [{ role: value.role, fitScore: clampScore(value.fitScore, baseScore), reason: value.reason }];
    }).slice(0, 8)
    : fallbackRoles;
  const report: ProfileAuditReport = {
    score: clampScore(ai?.score, baseScore),
    strengths: [...new Set([...stringList(ai?.strengths), ...strengths])].slice(0, 8),
    gaps: stringList(ai?.gaps),
    recruiterVerdict: typeof ai?.recruiterVerdict === "string" ? ai.recruiterVerdict : "O perfil tem base técnica forte, mas precisa ser avaliado pela clareza do posicionamento e pela evidência de impacto para cada cargo-alvo.",
    marketPositioning: typeof ai?.marketPositioning === "string" ? ai.marketPositioning : `Posicionamento híbrido entre ${asStringArray(profile.targetTitles).slice(0, 3).join(", ") || "Dados e Tecnologia"}.`,
    roleFit,
    suggestedHeadlines: stringList(ai?.suggestedHeadlines).slice(0, 5).length ? stringList(ai?.suggestedHeadlines).slice(0, 5) : suggestedHeadlines(profile),
    seoKeywords: [...new Set([...stringList(ai?.seoKeywords), ...keywords])].slice(0, 30),
    aboutRewrite: typeof ai?.aboutRewrite === "string" && ai.aboutRewrite.trim().length > 100 ? ai.aboutRewrite.trim().slice(0, 2_000) : aboutRewrite(profile, dossier),
    recommendations: [...new Set([...stringList(ai?.recommendations), ...recommendations, "Revisar o headline a cada mudança relevante de foco ou cargo-alvo.", "Publicar cases com contexto, decisão técnica e resultado verificável."])].slice(0, 10),
    jobHistoryCount: history.length,
    createdAt: persisted.createdAt.toISOString(),
  };
  await prisma.linkedInSeoAudit.update({
    where: { id: persisted.id },
    data: {
      score: report.score,
      strengths: report.strengths,
      recommendations: report.recommendations,
      snapshot: { ...report, profileId: profile.id },
    },
  });

  return report;
}
