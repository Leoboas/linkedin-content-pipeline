import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JobListingStatus, JobSource, Prisma, SearchRunStatus } from "@prisma/client";
import { SEARCH_LOCATIONS, TARGET_JOB_TITLES } from "../../config/job-targets";
import { prisma } from "@/lib/prisma";
import { asStringArray, buildCareerContext, calculateMatch, tokenize } from "@/lib/career-rag";
import { fetchLinkedInPublicJobs } from "@/lib/linkedin-job-fetcher";
import { extractSkillsFromText, normalizeSkills } from "@/lib/skills-normalizer";

export interface CareerJobPreview {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  score: number;
  label: string;
  matchedSkills: string[];
  skillGaps: string[];
  rationale: string;
}

interface FeedJob {
  id?: string;
  externalId?: string;
  title: string;
  company?: string;
  location?: string;
  remote?: boolean;
  url: string;
  description?: string;
  sourcePublishedAt?: string;
  source?: "LINKEDIN" | "AUTHORIZED_FEED" | "MANUAL";
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function profileJson(): { name: string; headline: string; about: string; skills: string[]; targetTitles: string[]; location?: string; linkedinUrl?: string } {
  const raw = process.env.CAREER_PROFILE_JSON;
  if (!raw?.trim()) {
    try {
      const dossier = readFileSync(join(process.cwd(), "data", "brand-dossier.md"), "utf8");
      const knownSkills = ["TypeScript", "Python", "Next.js", "PostgreSQL", "AWS", "Airflow", "Docker", "Data Lake", "Machine Learning", "IA"];
      const skills = knownSkills.filter((skill) => dossier.toLocaleLowerCase("pt-BR").includes(skill.toLocaleLowerCase("pt-BR")));
      return {
        name: "Perfil de demonstração",
        headline: "Engenharia de Dados | Arquitetura | Automação",
        about: dossier.slice(0, 3_000),
        skills: normalizeSkills(skills.length > 0 ? skills : ["Python", "SQL", "Cloud"]),
        targetTitles: [...TARGET_JOB_TITLES],
      };
    } catch (error) {
      throw new Error(`Perfil não encontrado no ENV, DB ou data/brand-dossier.md: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let parsed: unknown;
  const normalized = raw.trim().startsWith("'") && raw.trim().endsWith("'")
    ? raw.trim().slice(1, -1)
    : raw.trim();
  try { parsed = JSON.parse(normalized); } catch { throw new Error("CAREER_PROFILE_JSON não contém JSON válido."); }
  if (!parsed || typeof parsed !== "object") throw new Error("CAREER_PROFILE_JSON inválido.");
  const value = parsed as Record<string, unknown>;
  const name = text(value.name);
  const headline = text(value.headline);
  const about = text(value.about);
  if (!name || !headline || !about) throw new Error("CAREER_PROFILE_JSON exige name, headline e about.");
  return {
    name, headline, about,
    skills: normalizeSkills(Array.isArray(value.skills) ? value.skills.filter((item): item is string => typeof item === "string") : []),
    targetTitles: Array.isArray(value.targetTitles) ? value.targetTitles.filter((item): item is string => typeof item === "string") : [...TARGET_JOB_TITLES],
    ...(text(value.location) ? { location: text(value.location) } : {}),
    ...(text(value.linkedinUrl) ? { linkedinUrl: text(value.linkedinUrl) } : {}),
  };
}

export async function getOrCreateProfile() {
  const existing = await prisma.candidateProfile.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing && process.env.CAREER_PROFILE_JSON && existing.name.toLocaleLowerCase("pt-BR").includes("demonstra")) {
    const seed = profileJson();
    return prisma.candidateProfile.update({
      where: { id: existing.id },
      data: {
        name: seed.name,
        headline: seed.headline,
        about: seed.about,
        location: seed.location,
        linkedinUrl: seed.linkedinUrl,
        skills: normalizeSkills(seed.skills),
        targetTitles: seed.targetTitles,
      },
    });
  }
  if (existing) {
    const normalizedSkills = normalizeSkills(asStringArray(existing.skills));
    if (JSON.stringify(normalizedSkills) !== JSON.stringify(asStringArray(existing.skills))) {
      return prisma.candidateProfile.update({ where: { id: existing.id }, data: { skills: normalizedSkills } });
    }
    return existing;
  }
  const seed = profileJson();
  return prisma.candidateProfile.create({
    data: {
      name: seed.name,
      headline: seed.headline,
      about: seed.about,
      location: seed.location,
      linkedinUrl: seed.linkedinUrl,
      skills: seed.skills,
      targetTitles: seed.targetTitles,
    },
  });
}

function searchUrl(title: string, location: string): string {
  const params = new URLSearchParams({ keywords: title, location });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

async function fetchAuthorizedFeed(): Promise<FeedJob[]> {
  const url = process.env.LINKEDIN_JOBS_FEED_URL;
  if (!url) return [];
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Feed autorizado de vagas retornou HTTP ${response.status}.`);
  const payload = await response.json() as unknown;
  const items = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as { jobs?: unknown }).jobs) ? (payload as { jobs: unknown[] }).jobs : [];
  return items.flatMap((item): FeedJob[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const title = text(value.title);
    const urlValue = text(value.url);
    if (!title || !urlValue) return [];
    return [{
      externalId: text(value.externalId) ?? text(value.id), title, url: urlValue,
      ...(text(value.company) ? { company: text(value.company) } : {}),
      ...(text(value.location) ? { location: text(value.location) } : {}),
      remote: value.remote === true,
      description: text(value.description) ?? "",
      ...(text(value.sourcePublishedAt) ? { sourcePublishedAt: text(value.sourcePublishedAt) } : {}),
      source: value.source === "LINKEDIN" ? "LINKEDIN" : "AUTHORIZED_FEED",
    }];
  });
}

async function searchJobs(): Promise<{ jobs: FeedJob[]; queries: Array<{ title: string; location: string; url: string }> }> {
  const queries = TARGET_JOB_TITLES.flatMap((title) => SEARCH_LOCATIONS.map((location) => ({ title, location, url: searchUrl(title, location) })));
  const authorizedJobs = await fetchAuthorizedFeed();
  const publicJobs: FeedJob[] = [];
  for (const query of queries) {
    try {
      const results = await fetchLinkedInPublicJobs(query.title, query.location);
      publicJobs.push(...results.map((job) => ({
        externalId: job.linkedinJobId,
        title: job.title,
        company: job.company ?? undefined,
        location: job.location ?? undefined,
        url: job.url,
        description: "",
        source: "LINKEDIN" as const,
      })));
    } catch (error) {
      console.warn("[career] falha ao consultar LinkedIn Guest Jobs", {
        title: query.title,
        location: query.location,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  const deduplicated = new Map<string, FeedJob>();
  for (const job of [...authorizedJobs, ...publicJobs]) deduplicated.set(job.externalId ?? job.url, job);
  return { jobs: [...deduplicated.values()], queries };
}

export async function runCareerScan(): Promise<{ runId: string; matches: CareerJobPreview[]; queries: number; discovered: number; message: string }> {
  const run = await prisma.careerSearchRun.create({ data: { status: SearchRunStatus.RUNNING } });
  try {
    const profile = await getOrCreateProfile();
    const documents = await prisma.careerDocument.findMany({ where: { profileId: profile.id }, select: { title: true, content: true } });
    const context = buildCareerContext({ profile, documents });
    const search = await searchJobs();
    const matches: CareerJobPreview[] = [];

    for (const input of search.jobs) {
      const job = await prisma.jobListing.upsert({
        where: { source_externalId: { source: input.source === "LINKEDIN" ? JobSource.LINKEDIN : JobSource.AUTHORIZED_FEED, externalId: input.externalId ?? input.url } },
        update: { title: input.title, company: input.company, location: input.location, remote: input.remote ?? false, url: input.url, description: input.description ?? "", status: JobListingStatus.OPEN },
        create: { source: input.source === "LINKEDIN" ? JobSource.LINKEDIN : JobSource.AUTHORIZED_FEED, externalId: input.externalId ?? input.url, title: input.title, company: input.company, location: input.location, remote: input.remote ?? false, url: input.url, description: input.description ?? "", sourcePublishedAt: input.sourcePublishedAt ? new Date(input.sourcePublishedAt) : undefined },
      });
      const result = calculateMatch({ profileSkills: asStringArray(profile.skills), profileContext: context, jobTitle: job.title, jobDescription: job.description });
      await prisma.jobMatch.upsert({
        where: { profileId_jobId: { profileId: profile.id, jobId: job.id } },
        update: { score: result.score, label: result.label, matchedSkills: result.matchedSkills, skillGaps: result.skillGaps, rationale: result.rationale, ragContext: context.slice(0, 10000) },
        create: { profileId: profile.id, jobId: job.id, score: result.score, label: result.label, matchedSkills: result.matchedSkills, skillGaps: result.skillGaps, rationale: result.rationale, ragContext: context.slice(0, 10000) },
      });
      matches.push({ id: job.id, title: job.title, company: job.company, location: job.location, url: job.url, ...result });
    }

    const skillCounts = new Map<string, number>();
    for (const job of search.jobs) {
      for (const skill of extractSkillsFromText(`${job.title} ${job.description}`)) {
        skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1);
      }
    }
    const profileSkills = normalizeSkills(asStringArray(profile.skills));
    for (const [skill, demandCount] of skillCounts.entries()) {
      const candidateLevel = profileSkills.includes(skill) ? 1 : 0;
      await prisma.skillRadar.upsert({ where: { skill_category: { skill, category: "job-market" } }, update: { demandCount, candidateLevel, gapScore: candidateLevel ? 0 : Math.min(100, demandCount * 10), evidence: { source: "authorized-feed" } }, create: { skill, category: "job-market", demandCount, candidateLevel, gapScore: candidateLevel ? 0 : Math.min(100, demandCount * 10), evidence: { source: "authorized-feed" } } });
    }

    const sorted = matches.sort((left, right) => right.score - left.score).slice(0, 20);
    await prisma.careerSearchRun.update({ where: { id: run.id }, data: { status: SearchRunStatus.COMPLETED, queryCount: search.queries.length, resultCount: search.jobs.length, completedAt: new Date() } });
    return { runId: run.id, matches: sorted, queries: search.queries.length, discovered: search.jobs.length, message: search.jobs.length ? "Vagas atualizadas a partir das consultas públicas do LinkedIn e de feeds autorizados." : "Nenhuma vaga retornada pelo LinkedIn Guest Jobs ou por feed autorizado." };
  } catch (error) {
    await prisma.careerSearchRun.update({ where: { id: run.id }, data: { status: SearchRunStatus.FAILED, errorMessage: error instanceof Error ? error.message : "Erro desconhecido", completedAt: new Date() } });
    throw error;
  }
}

export async function getCareerDashboardData() {
  const profile = await getOrCreateProfile();
  const matches = await prisma.jobMatch.findMany({ where: { profileId: profile.id }, include: { job: true }, orderBy: [{ score: "desc" }, { createdAt: "desc" }], take: 30 });
  const radar = await prisma.skillRadar.findMany({ orderBy: [{ gapScore: "desc" }, { demandCount: "desc" }], take: 30 });
  const audit = await prisma.linkedInSeoAudit.findFirst({ where: { profileId: profile.id }, orderBy: { createdAt: "desc" } });
  return { profile, matches, radar, audit };
}

export async function analyzeManualJob(jobId: string, description: string) {
  const job = await prisma.jobListing.findUnique({ where: { id: jobId } });
  if (!job || job.source !== JobSource.MANUAL) throw new Error("Vaga manual não encontrada.");
  const profile = await getOrCreateProfile();
  const documents = await prisma.careerDocument.findMany({ where: { profileId: profile.id }, select: { title: true, content: true } });
  const context = buildCareerContext({ profile, documents });
  const result = calculateMatch({ profileSkills: asStringArray(profile.skills), profileContext: context, jobTitle: job.title, jobDescription: description });
  await prisma.jobListing.update({ where: { id: job.id }, data: { description, status: JobListingStatus.OPEN } });
  await prisma.jobMatch.upsert({
    where: { profileId_jobId: { profileId: profile.id, jobId: job.id } },
    update: { score: result.score, label: result.label, matchedSkills: result.matchedSkills, skillGaps: result.skillGaps, rationale: result.rationale, ragContext: context.slice(0, 10000) },
    create: { profileId: profile.id, jobId: job.id, score: result.score, label: result.label, matchedSkills: result.matchedSkills, skillGaps: result.skillGaps, rationale: result.rationale, ragContext: context.slice(0, 10000) },
  });
  const pitch = `Olá! Sou ${profile.name}, ${profile.headline}. Tenho experiência prática em ${result.matchedSkills.slice(0, 5).join(", ") || "engenharia e resolução de problemas"}. Gostaria de conversar sobre como posso contribuir para esta posição.`;
  return { ...result, title: job.title, jobUrl: job.url, pitch };
}

export async function auditLinkedInProfile() {
  const profile = await getOrCreateProfile();
  const skills = asStringArray(profile.skills);
  const targets = asStringArray(profile.targetTitles);
  const strengths = [
    profile.headline.length >= 40 ? "Headline comunica especialidade" : "Headline curta",
    profile.about.length >= 300 ? "Sobre tem contexto suficiente" : "Sobre precisa de mais evidências",
    skills.length >= 8 ? "Competências relevantes cadastradas" : "Poucas competências cadastradas",
  ];
  const recommendations = [
    ...(profile.headline.length < 40 ? ["Explicitar especialidade, domínio e resultado no headline."] : []),
    ...(profile.about.length < 300 ? ["Adicionar 2 cases com problema, ação e resultado mensurável."] : []),
    ...(skills.length < 8 ? ["Adicionar competências técnicas alinhadas aos cargos-alvo."] : []),
    ...(targets.length === 0 ? ["Definir cargos-alvo para melhorar a busca."] : []),
  ];
  const score = Math.round(Math.min(100, (profile.headline.length >= 40 ? 35 : 15) + (profile.about.length >= 300 ? 35 : 15) + (skills.length >= 8 ? 30 : skills.length * 3)));
  return prisma.linkedInSeoAudit.create({ data: { profileId: profile.id, score, strengths, recommendations, snapshot: { headline: profile.headline, skills, targetTitles: targets } } });
}

export function linkedinSearchQueries() {
  return TARGET_JOB_TITLES.flatMap((title) => SEARCH_LOCATIONS.map((location) => ({ title, location, url: searchUrl(title, location) })));
}
