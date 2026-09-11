import { createHash } from "node:crypto";
import { JobListingStatus, JobSource } from "@prisma/client";
import { generateTextWithFallback } from "@/lib/ai-provider";
import { analyzeManualJob } from "@/lib/career-engine";
import { extractSkillsFromText, normalizeSkills } from "@/lib/skills-normalizer";
import { prisma } from "@/lib/prisma";

const MIN_JOB_DESCRIPTION_LENGTH = 240;
const GENERIC_TITLE_PATTERN = /^(vaga|job|opportunit|descri[cç][aã]o|description|linkedin|telegram)/i;
const BLOCKED_PAGE_PATTERN = /authwall|join linkedin|sign in|entrar no linkedin|access denied|captcha|page not found|não foi possível encontrar esta página|esta vaga não está mais disponível/i;
const FORBIDDEN_SKILL_PATTERN = /^(vaga|job|shared|compartilhada|pelo|telegram|linkedin|de|da|do|das|dos|para|com|em|no|na|o|a|os|as|um|uma|remoto|remote|sênior|senior|pleno|junior|júnior)$/i;

export class JobDescriptionUnavailableError extends Error {
  constructor(message = "Não foi possível obter uma descrição válida da vaga.") {
    super(message);
    this.name = "JobDescriptionUnavailableError";
  }
}

export interface InboundJobInput {
  url?: string;
  subject?: string;
  body: string;
}

export interface InboundJobAnalysis {
  isNew: boolean;
  jobId: string;
  title: string;
  company: string | null;
  score: number;
  label: string;
  matchedSkills: string[];
  skillGaps: string[];
  rationale: string;
  pitch: string;
  jobUrl: string;
}

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function cleanTitle(subject: string | undefined): string | null {
  const value = normalizeText(subject).replace(/^(vaga|job opportunity)\s*[:|-]\s*/i, "").trim();
  if (!value || value.length > 180 || GENERIC_TITLE_PATTERN.test(value)) return null;
  return value;
}

function cleanCompany(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const company = normalizeText(value).replace(/^["']|["']$/g, "");
  if (!company || company.length > 160 || GENERIC_TITLE_PATTERN.test(company)) return null;
  return company;
}

function validDescription(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length < MIN_JOB_DESCRIPTION_LENGTH) return false;
  return !BLOCKED_PAGE_PATTERN.test(normalized.slice(0, 12_000));
}

function fallbackTitle(subject: string | undefined, description: string): string | null {
  const fromSubject = cleanTitle(subject);
  if (fromSubject) return fromSubject;
  const lines = description.split(/\r?\n/).map((line) => normalizeText(line.replace(/^[-*#>•\d.)\s]+/, ""))).filter(Boolean);
  return lines.find((line) => line.length >= 8 && line.length <= 180 && !GENERIC_TITLE_PATTERN.test(line)) ?? null;
}

function fallbackCompany(description: string): string | null {
  const match = description.match(/(?:empresa|company|contratante|employer)\s*[:|-]\s*([^\n|]{2,160})/i);
  return cleanCompany(match?.[1]);
}

function parseJsonResponse(value: string): Record<string, unknown> {
  const fence = String.fromCharCode(96).repeat(3);
  const cleaned = value.trim().startsWith(fence) ? value.trim().slice(fence.length).replace(/^json\s*/i, "").replace(new RegExp(fence + "\\s*$"), "").trim() : value.trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("A extração da vaga não retornou JSON válido.");
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function canonicalSkills(values: string[]): string[] {
  const normalized = normalizeSkills(values);
  return [...new Set(normalized.filter((skill) => skill.length >= 3 && !FORBIDDEN_SKILL_PATTERN.test(skill)))].slice(0, 30);
}

async function extractJobData(subject: string | undefined, description: string): Promise<{ title: string; company: string | null; hardSkills: string[]; softSkills: string[] }> {
  const fallback = {
    title: fallbackTitle(subject, description),
    company: fallbackCompany(description),
    hardSkills: canonicalSkills(extractSkillsFromText(description)),
    softSkills: [],
  };
  try {
    const response = await generateTextWithFallback({
      model: process.env.JOB_MATCHER_MODEL || "gemini-3.6-flash",
      temperature: 0,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Você é um Tech Recruiter sênior. Extraia o Título da Vaga e a Empresa do texto fornecido. Se não encontrar, infira pelo contexto.",
            "É PROIBIDO extrair palavras genéricas, preposições, artigos ou termos de UI como skills: vaga, compartilhada, pelo, telegram, de, para, remoto, sênior, senior, job, linkedin.",
            "Extraia APENAS Hard Skills reais (tecnologias, frameworks, linguagens, ferramentas e conceitos de arquitetura) e Soft Skills relevantes do mercado corporativo.",
            "Sempre retorne os termos de skills em Inglês Canônico quando houver equivalente conhecido, como node.js -> Node.js e docker -> Docker.",
            "Se o texto não for uma descrição de vaga válida ou for apenas uma URL/fallback genérico, retorne validJob=false e score=0.",
            "Responda exclusivamente JSON no formato: {validJob:boolean, score:number, title:string, company:string|null, hardSkills:string[], softSkills:string[]}.",
          ].join(" "),
        },
        { role: "user", content: description.slice(0, 18_000) },
      ],
    });
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("Resposta vazia do extrator de vagas.");
    const parsed = parseJsonResponse(content);
    const validJob = parsed.validJob !== false && Number(parsed.score ?? 1) > 0;
    const title = cleanTitle(typeof parsed.title === "string" ? parsed.title : undefined) ?? fallback.title;
    if (!validJob || !title) throw new JobDescriptionUnavailableError("O conteúdo recebido não parece ser uma descrição de vaga válida.");
    return {
      title,
      company: cleanCompany(parsed.company) ?? fallback.company,
      hardSkills: canonicalSkills(stringArray(parsed.hardSkills).concat(fallback.hardSkills)),
      softSkills: canonicalSkills(stringArray(parsed.softSkills)),
    };
  } catch (error) {
    if (error instanceof JobDescriptionUnavailableError) throw error;
    if (!fallback.title) throw new JobDescriptionUnavailableError("Não consegui identificar o título da vaga no conteúdo recebido.");
    console.warn("[job-matcher] extração por IA indisponível; usando fallback seguro.", error instanceof Error ? error.message : String(error));
    return { title: fallback.title, company: fallback.company, hardSkills: fallback.hardSkills, softSkills: fallback.softSkills };
  }
}

async function readWithJina(url: string): Promise<string | null> {
  // Jina is a lightweight reader; the e-mail body remains the source of truth
  // when LinkedIn or Jina does not expose the public job description.
  const jinaUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
  const headers: HeadersInit = { Accept: "text/plain" };
  if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  try {
    const response = await fetch(jinaUrl, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    const content = (await response.text()).trim();
    return validDescription(content) ? content.slice(0, 100_000) : null;
  } catch (error) {
    console.warn("[job-matcher] Jina Reader indisponivel; usando corpo recebido", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function matchInboundJob(input: InboundJobInput): Promise<InboundJobAnalysis> {
  const url = input.url?.trim() ? new URL(input.url.trim()).toString() : null;
  if (url && !/^https?:$/.test(new URL(url).protocol)) throw new Error("A URL da vaga precisa usar HTTP ou HTTPS.");
  const submittedBody = input.body.trim();
  const jinaContent = !submittedBody && url ? await readWithJina(url) : null;
  const description = (submittedBody || jinaContent || "").trim().slice(0, 100_000);
  if (!validDescription(description)) {
    throw new JobDescriptionUnavailableError(
      url ? "O LinkedIn bloqueou a leitura automática desse link ou retornou uma página sem descrição." : "Envie um bloco de texto maior com a descrição completa da vaga.",
    );
  }

  const extracted = await extractJobData(input.subject, description);
  const externalId = url ?? "telegram:" + createHash("sha256").update(description).digest("hex").slice(0, 40);
  const jobUrl = url ?? "https://www.linkedin.com/jobs/";
  const existing = await prisma.jobListing.findUnique({ where: { source_externalId: { source: JobSource.MANUAL, externalId } } });
  const rawData = { source: url ? "telegram-url" : "telegram-manual-text", extracted: { hardSkills: extracted.hardSkills, softSkills: extracted.softSkills } };
  const job = existing
    ? await prisma.jobListing.update({
        where: { id: existing.id },
        data: { title: extracted.title, company: extracted.company, url: jobUrl, description, status: JobListingStatus.OPEN, rawData },
      })
    : await prisma.jobListing.create({
        data: { source: JobSource.MANUAL, externalId, title: extracted.title, company: extracted.company, url: jobUrl, description, status: JobListingStatus.OPEN, rawData },
      });
  const analysis = await analyzeManualJob(job.id, description);
  return { isNew: !existing, jobId: job.id, company: extracted.company, ...analysis };
}
