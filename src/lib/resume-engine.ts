import { ResumeDraftStatus, type Prisma } from "@prisma/client";
import { getResumeTemplate, type ResumeTemplateId } from "../../config/resume-templates";
import { generateTextWithFallback } from "@/lib/ai-provider";
import { asStringArray, buildCareerContext } from "@/lib/career-rag";
import { getOrCreateProfile } from "@/lib/career-engine";
import { normalizeSkills } from "@/lib/skills-normalizer";
import { prisma } from "@/lib/prisma";

export interface ResumeContent {
  headline: string;
  summary: string;
  skills: Array<{ category: string; items: string[] }>;
  experience: Array<{ role: string; company: string; period: string; bullets: string[] }>;
  projects: Array<{ name: string; description: string; stack: string[] }>;
  education: string[];
  languages: string[];
  keywords: string[];
}

export interface ResumeValidation {
  score: number;
  strengths: string[];
  warnings: string[];
  missingKeywords: string[];
  atsReady: boolean;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function objectList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
}

function parseJson(value: string): Record<string, unknown> {
  const fence = String.fromCharCode(96).repeat(3);
  const trimmed = value.trim();
  const cleaned = trimmed.startsWith(fence) ? trimmed.slice(fence.length).replace(/^json\s*/i, "").replace(new RegExp(fence + "\\s*$"), "").trim() : trimmed;
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Resposta do construtor de currículo não é JSON válido.");
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  }
}

function resumeContent(value: Record<string, unknown>): ResumeContent {
  return {
    headline: text(value.headline),
    summary: text(value.summary),
    skills: objectList(value.skills).map((item) => ({ category: text(item.category) || "Core Skills", items: normalizeSkills(stringList(item.items)) })),
    experience: objectList(value.experience).map((item) => ({ role: text(item.role), company: text(item.company), period: text(item.period), bullets: stringList(item.bullets) })).filter((item) => item.role || item.company),
    projects: objectList(value.projects).map((item) => ({ name: text(item.name), description: text(item.description), stack: normalizeSkills(stringList(item.stack)) })).filter((item) => item.name || item.description),
    education: stringList(value.education),
    languages: stringList(value.languages),
    keywords: normalizeSkills(stringList(value.keywords)),
  };
}

function fallbackContent(profile: { name: string; headline: string; about: string; skills: Prisma.JsonValue; experience: Prisma.JsonValue | null; education: Prisma.JsonValue | null }, templateId: ResumeTemplateId): ResumeContent {
  const skills = normalizeSkills(asStringArray(profile.skills));
  const experience = objectList(profile.experience).map((item) => ({ role: text(item.role), company: text(item.company), period: text(item.period), bullets: stringList(item.bullets) })).filter((item) => item.role || item.company);
  const education = stringList(profile.education);
  return {
    headline: profile.headline,
    summary: profile.about,
    skills: [{ category: templateId === "ats-data" ? "Data & Cloud" : "Technical & Leadership Skills", items: skills }],
    experience,
    projects: [],
    education,
    languages: [],
    keywords: skills,
  };
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase("en-US").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").match(/[a-z0-9+#.]{3,}/g) ?? []);
}

export function validateResume(content: ResumeContent, targetRole: string, jobDescription = ""): ResumeValidation {
  const fullText = JSON.stringify(content);
  const tokens = tokenize(fullText);
  const jobTokens = tokenize(jobDescription);
  const missingKeywords = [...jobTokens].filter((keyword) => !tokens.has(keyword)).slice(0, 12);
  const warnings: string[] = [];
  const strengths: string[] = [];
  let score = 0;
  if (content.headline.length >= 30) { score += 15; strengths.push("Headline posiciona o candidato para o cargo-alvo."); } else warnings.push("Headline curta ou ausente.");
  if (content.summary.length >= 250) { score += 15; strengths.push("Resumo profissional tem contexto e especialidade."); } else warnings.push("Resumo profissional precisa de mais contexto."); 
  const skillCount = content.skills.reduce((total, group) => total + group.items.length, 0);
  if (skillCount >= 8) { score += 20; strengths.push("Skills canônicas suficientes para indexação ATS."); } else warnings.push("Poucas skills canônicas foram identificadas.");
  if (content.experience.length >= 2) { score += 20; strengths.push("Experiência apresenta mais de uma posição relevante."); } else warnings.push("Experiência profissional insuficiente para o cargo-alvo.");
  const bulletCount = content.experience.reduce((total, item) => total + item.bullets.length, 0);
  if (bulletCount >= 6) score += 15; else warnings.push("Adicione bullets com ação, contexto e resultado.");
  if (/\\d|%|r\\$|usd/i.test(fullText)) { score += 10; strengths.push("Há evidências quantitativas no conteúdo."); } else warnings.push("Inclua métricas verificáveis quando existirem.");
  if (jobDescription && missingKeywords.length <= 5) score += 5; else if (jobDescription) warnings.push("Algumas palavras-chave da vaga ainda não aparecem no currículo.");
  if (/revolucionário|desbloquear|mergulhar|alavancar|no mundo dinâmico de hoje/i.test(fullText)) warnings.push("Remova clichês de IA e linguagem genérica.");
  if (!targetRole.trim()) warnings.push("Cargo-alvo não informado.");
  return { score: Math.min(100, score), strengths, warnings, missingKeywords, atsReady: score >= 75 && warnings.length <= 3 };
}

async function generateContent(input: {
  profile: { name: string; headline: string; about: string; skills: Prisma.JsonValue; targetTitles: Prisma.JsonValue; experience: Prisma.JsonValue | null; education: Prisma.JsonValue | null };
  context: string;
  targetRole: string;
  templateId: ResumeTemplateId;
  jobDescription: string;
  feedback: string;
  previous?: ResumeContent;
}): Promise<ResumeContent> {
  const template = getResumeTemplate(input.templateId);
  const fallback = fallbackContent(input.profile, input.templateId);
  try {
    const response = await generateTextWithFallback({
      model: process.env.RESUME_BUILDER_MODEL || "gemini-3.6-flash",
      temperature: 0.2,
      max_tokens: 2600,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Você é uma recrutadora sênior de tecnologia e especialista em ATS, não uma geradora de textos genéricos.",
            "Crie um currículo direcionado ao cargo-alvo em português do Brasil, mantendo nomes de tecnologias em inglês canônico.",
            "Use somente fatos, cargos, empresas, datas, projetos, métricas e tecnologias presentes no perfil ou no contexto fornecido. Nunca invente experiência.",
            "Priorize evidência: ação técnica ou de liderança, contexto do problema e resultado verificável. Não use emojis, tabelas, colunas, barras de proficiência ou frases vazias.",
            "Elimine vícios de IA, clichês corporativos e repetições. O currículo deve ser legível por ATS e por uma recrutadora humana.",
            "Estrutura obrigatória JSON: {headline,summary,skills:[{category,items}],experience:[{role,company,period,bullets}],projects:[{name,description,stack}],education:string[],languages:string[],keywords:string[]}.",
            "Template escolhido: " + template.label + ". Regras: " + template.rules.join(" "),
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            targetRole: input.targetRole,
            feedback: input.feedback,
            profile: { name: input.profile.name, headline: input.profile.headline, about: input.profile.about, skills: normalizeSkills(asStringArray(input.profile.skills)), targetTitles: asStringArray(input.profile.targetTitles), experience: input.profile.experience, education: input.profile.education },
            context: input.context.slice(0, 18_000),
            jobDescription: input.jobDescription.slice(0, 12_000),
            previousDraft: input.previous,
          }),
        },
      ],
    });
    const responseText = response.choices[0]?.message.content;
    if (!responseText) throw new Error("Construtor de currículo retornou resposta vazia.");
    return resumeContent(parseJson(responseText));
  } catch (error) {
    console.warn("[resume-engine] IA indisponível; usando conteúdo-base validável.", error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

export async function listResumeDrafts() {
  const profile = await getOrCreateProfile();
  return prisma.resumeDraft.findMany({ where: { profileId: profile.id }, orderBy: { updatedAt: "desc" }, take: 20 });
}

export async function generateResumeDraft(input: {
  targetRole: string;
  template?: string;
  jobId?: string;
  feedback?: string;
  draftId?: string;
  sourceText?: string;
}) {
  const profile = await getOrCreateProfile();
  const template = getResumeTemplate(input.template);
  const sourceJob = input.jobId ? await prisma.jobListing.findUnique({ where: { id: input.jobId } }) : null;
  const previousDraft = input.draftId ? await prisma.resumeDraft.findUnique({ where: { id: input.draftId } }) : null;
  const documents = await prisma.careerDocument.findMany({ where: { profileId: profile.id }, select: { title: true, content: true } });
  const context = buildCareerContext({ profile, documents }) + (input.sourceText?.trim() ? "\n\nMaterial adicional fornecido para esta revisão:\n" + input.sourceText.trim().slice(0, 18_000) : "");
  const jobDescription = sourceJob?.description ?? previousDraft?.jobDescription ?? "";
  const content = await generateContent({
    profile,
    context,
    targetRole: input.targetRole.trim(),
    templateId: template.id,
    jobDescription,
    feedback: input.feedback?.trim() ?? "",
    previous: previousDraft ? resumeContent((previousDraft.content ?? {}) as Record<string, unknown>) : undefined,
  });
  const validation = validateResume(content, input.targetRole, jobDescription);
  return prisma.resumeDraft.create({
    data: {
      profileId: profile.id,
      sourceJobId: sourceJob?.id,
      targetRole: input.targetRole.trim(),
      template: template.id,
      jobDescription: jobDescription || null,
      content: content as unknown as Prisma.InputJsonValue,
      atsScore: validation.score,
      validation: validation as unknown as Prisma.InputJsonValue,
      status: ResumeDraftStatus.AWAITING_REVIEW,
    },
  });
}
