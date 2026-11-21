import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JobListingStatus, JobSource, KnowledgeEvidenceStatus, KnowledgeVisibility, Prisma, SearchRunStatus } from "@prisma/client";
import { getDefaultCareerTargetTitles, normalizeCareerTargetTitles, SEARCH_LOCATIONS, TARGET_JOB_TITLES } from "../../config/job-targets";
import { prisma } from "@/lib/prisma";
import { asStringArray, buildCareerContext, calculateMatch, tokenize } from "@/lib/career-rag";
import { extractSkillsFromText, normalizeSkills } from "@/lib/skills-normalizer";
import { assessJobEligibility, fetchCareerSources, isRelevantEngineeringJob, jobDeduplicationKey, normalizeCountryCode, type CareerSourceKey, type CareerSourceMode } from "@/lib/job-source-connectors";
import { recommendAuthorizedResume } from "../../config/authorized-resumes";

export interface CareerJobPreview {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  description: string;
  score: number;
  label: string;
  matchedSkills: string[];
  skillGaps: string[];
  rationale: string;
  eligibilityStatus: "BRAZIL_ELIGIBLE" | "LATAM_ELIGIBLE" | "WORLDWIDE_ELIGIBLE" | "RELOCATION_REQUIRED" | "REGION_RESTRICTED" | "UNKNOWN";
  eligibilityReasons: string[];
  sourceName: string;
  sourceUrl: string;
  recommendedResume: string | null;
  recommendedResumeReason: string | null;
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
  sourceKey: CareerSourceKey;
  attributionName: string;
  attributionUrl: string;
  sourceMode: CareerSourceMode;
  sourceRefs: Array<{ key: CareerSourceKey; url: string; attributionName: string; attributionUrl: string }>;
  listingUrl?: string;
  employerCountry: string | null;
  workLocationCountry: string | null;
  workplaceType: string | null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function jsonDocument(value: unknown): Prisma.InputJsonValue | undefined {
  return value && typeof value === "object" ? value as Prisma.InputJsonValue : undefined;
}

type ProfileSeed = { name: string; headline: string; about: string; skills: string[]; targetTitles: string[]; location?: string; linkedinUrl?: string; experience?: Prisma.InputJsonValue; education?: Prisma.InputJsonValue };

function profileJson(): ProfileSeed | null {
  const raw = process.env.CAREER_PROFILE_JSON;
  if (!raw?.trim()) return null;
  if (!raw?.trim()) throw new Error("CAREER_PROFILE_JSON ausente. O dossiê editorial de demonstração não pode ser usado como perfil profissional. Configure um perfil autorizado ou importe experiências verificadas.");
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
        targetTitles: getDefaultCareerTargetTitles(),
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
    targetTitles: normalizeCareerTargetTitles(Array.isArray(value.targetTitles) ? value.targetTitles.filter((item): item is string => typeof item === "string") : []),
    ...(text(value.location) ? { location: text(value.location) } : {}),
    ...(text(value.linkedinUrl) ? { linkedinUrl: text(value.linkedinUrl) } : {}),
    ...(jsonDocument(value.experience) ? { experience: jsonDocument(value.experience) } : {}),
    ...(jsonDocument(value.education) ? { education: jsonDocument(value.education) } : {}),
  };
}

async function profileFromVerifiedKnowledge(): Promise<ProfileSeed> {
  const publicEvidence = { publicAllowed: true, visibility: KnowledgeVisibility.PUBLIC_SAFE, evidenceStatus: { in: [KnowledgeEvidenceStatus.VERIFIED, KnowledgeEvidenceStatus.DOCUMENTED, KnowledgeEvidenceStatus.USER_CONFIRMED] } };
  const [facts, experiences, projects] = await Promise.all([
    prisma.professionalFact.findMany({ where: publicEvidence, select: { claim: true } }),
    prisma.professionalExperience.findMany({ where: publicEvidence, select: { company: true, title: true, summary: true, technologies: true } }),
    prisma.portfolioProject.findMany({ where: { ...publicEvidence, implementationStatus: { in: ["IMPLEMENTED", "USED_IN_PORTFOLIO"] } }, select: { name: true, summary: true, technologies: true } }),
  ]);
  if (!facts.length && !experiences.length && !projects.length) {
    throw new Error("Não há perfil autorizado nem fatos, experiências ou projetos públicos verificados para construir as recomendações. Importe os dados profissionais autorizados antes de buscar.");
  }
  const evidenceText = [
    ...facts.map((fact) => fact.claim),
    ...experiences.map((item) => `${item.title} ${item.company}: ${item.summary}`),
    ...projects.map((item) => `${item.name}: ${item.summary}`),
  ].join("\n\n");
  const technologies = [...experiences.flatMap((item) => asStringArray(item.technologies)), ...projects.flatMap((item) => asStringArray(item.technologies))];
  const targetTitles = getDefaultCareerTargetTitles();
  return {
    name: "Nome pendente de confirmação",
    headline: "Python Backend Engineer · Data Engineer · Software Engineer",
    about: evidenceText.slice(0, 6_000),
    skills: normalizeSkills([...technologies, ...extractSkillsFromText(evidenceText)]),
    targetTitles,
    experience: [...experiences.map((item) => ({ type: "professional-experience", company: item.company, title: item.title, summary: item.summary })), ...projects.map((item) => ({ type: "portfolio-project", name: item.name, summary: item.summary }))] as unknown as Prisma.InputJsonValue,
  };
}

export async function getOrCreateProfile() {
  const existing = await prisma.candidateProfile.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing && (existing.name.toLocaleLowerCase("pt-BR").includes("demonstra") || existing.name.toLocaleLowerCase("pt-BR").includes("pendente de confirma"))) {
    const seed = profileJson() ?? await profileFromVerifiedKnowledge();
    return prisma.candidateProfile.update({
      where: { id: existing.id },
      data: {
        name: seed.name,
        headline: seed.headline,
        about: seed.about,
        location: seed.location,
        linkedinUrl: seed.linkedinUrl,
        skills: normalizeSkills(seed.skills),
        targetTitles: seed.targetTitles.length ? seed.targetTitles : getDefaultCareerTargetTitles(),
        experience: seed.experience,
        education: seed.education,
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
  const seed = profileJson() ?? await profileFromVerifiedKnowledge();
  return prisma.candidateProfile.create({
    data: {
      name: seed.name,
      headline: seed.headline,
      about: seed.about,
      location: seed.location,
      linkedinUrl: seed.linkedinUrl,
      skills: seed.skills,
      targetTitles: seed.targetTitles.length ? seed.targetTitles : getDefaultCareerTargetTitles(),
      experience: seed.experience,
      education: seed.education,
    },
  });
}

function searchUrl(title: string, location: string): string {
  const params = new URLSearchParams({ keywords: title, location });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

export { normalizeCountryCode };

async function searchJobs(sourceKeys: string[]): Promise<{ jobs: FeedJob[]; sourceResults: Awaited<ReturnType<typeof fetchCareerSources>>["results"]; queryCount: number }> {
  const sources = await fetchCareerSources({ sourceKeys });
  const jobs = sources.jobs.filter(isRelevantEngineeringJob).map((job): FeedJob => ({
    externalId: job.externalId,
    title: job.title,
    company: job.company ?? undefined,
    location: job.location ?? undefined,
    remote: job.remote,
    url: job.url,
    description: job.description,
    sourcePublishedAt: job.publishedAt ?? undefined,
    sourceKey: job.sourceKey,
    attributionName: job.attributionName,
    attributionUrl: job.attributionUrl,
    sourceMode: job.sourceMode,
    sourceRefs: [{ key: job.sourceKey, url: job.listingUrl ?? job.url, attributionName: job.attributionName, attributionUrl: job.attributionUrl }],
    listingUrl: job.listingUrl,
    employerCountry: job.employerCountry,
    workLocationCountry: job.workLocationCountry,
    workplaceType: job.workplaceType,
  }));
  // These public feeds are not query APIs. A token overlap against the title
  // used to discard otherwise relevant listings before their match was scored.
  const relevant = jobs;
  const deduplicated = new Map<string, FeedJob>();
  for (const job of relevant) {
    const key = jobDeduplicationKey({ title: job.title, company: job.company ?? null, location: job.location ?? null });
    const previous = deduplicated.get(key);
    if (!previous) deduplicated.set(key, job);
    else previous.sourceRefs = [...previous.sourceRefs, ...job.sourceRefs];
  }
  return { jobs: [...deduplicated.values()].slice(0, 150), sourceResults: sources.results, queryCount: sources.results.filter((source) => source.status !== "NOT_SELECTED").length };
}

export async function runCareerScan(existingRunId?: string): Promise<{ runId: string; matches: CareerJobPreview[]; queries: number; discovered: number; message: string }> {
  const run = existingRunId
    ? await prisma.careerSearchRun.update({ where: { id: existingRunId }, data: { status: SearchRunStatus.RUNNING, errorMessage: null, completedAt: null, executionStartedAt: new Date() } })
    : await prisma.careerSearchRun.create({ data: { status: SearchRunStatus.RUNNING, executionStartedAt: new Date() } });
  try {
    const profile = await getOrCreateProfile();
    const preferences = await prisma.jobSearchPreference.findUnique({ where: { profileId: profile.id } });
    const preferredTitles = asStringArray(preferences?.targetTitles);
    const preferredLocations = asStringArray(preferences?.locations);
    const documents = await prisma.careerDocument.findMany({ where: { profileId: profile.id }, select: { title: true, content: true } });
    const context = buildCareerContext({ profile, documents });
    const configuredTargets = normalizeCareerTargetTitles(preferredTitles.length ? preferredTitles : asStringArray(profile.targetTitles));
    const targetTitles = configuredTargets.length ? configuredTargets : getDefaultCareerTargetTitles();
    const locations = preferredLocations.length ? preferredLocations : [...SEARCH_LOCATIONS];
    const selectedSourceKeys = asStringArray(preferences?.sourceKeys);
    const sourceKeys = selectedSourceKeys.length ? selectedSourceKeys : ["CODERIO_LEVER", "HIMALAYAS", "REMOTIVE", "REMOTE_OK", "WE_WORK_REMOTELY"];
    const employerMarkets = asStringArray(preferences?.employerMarkets);
    const search = await searchJobs(sourceKeys);
    const resumeKeys = new Set(["data-engineering-pt-br-v2", "data-engineering-en-v2", "python-backend-en-v2", "python-backend-pt-br-v2"]);
    const authorizedResumes = await prisma.authorizedResume.findMany({ where: { profileId: profile.id, resumeKey: { in: [...resumeKeys] } }, select: { id: true, resumeKey: true, originalName: true, sha256: true, version: true } });
    const matches: CareerJobPreview[] = [];
    const persistedBySource = new Map<string, number>();

    for (const input of search.jobs) {
      const eligibility = assessJobEligibility({ ...input, location: input.location ?? null, remote: input.remote === true, description: input.description ?? "" }, locations);
      if (preferences?.remoteOnly && !input.remote) continue;
      const resumeRecommendation = recommendAuthorizedResume({ title: input.title, description: input.description ?? "", languageHint: /portugu[eê]s|brazil|brasil/i.test(`${input.title} ${input.location ?? ""} ${input.description ?? ""}`) ? "PT_BR" : "EN" });
      const availableResume = resumeRecommendation ? authorizedResumes.find((resume) => resume.resumeKey === resumeRecommendation.resumeKey) : undefined;
      const country = input.employerCountry?.toUpperCase() ?? null;
      const employerMarket = country === "US" ? "US" : country && ["GB", "DE", "FR", "ES", "IT", "NL", "PT", "IE", "SE", "NO", "FI", "DK", "BE", "CH", "AT", "PL"].includes(country) ? "EU" : "UNKNOWN";
      // Most feeds expose job location, not employer headquarters; keep unknown-market jobs visible for review.
      if (employerMarkets.length && employerMarket !== "UNKNOWN" && !employerMarkets.includes("GLOBAL") && !employerMarkets.includes(employerMarket)) continue;
      const sourceMetadata = {
        sourceKey: input.sourceKey, attributionName: input.attributionName, attributionUrl: input.attributionUrl,
        sourceMode: input.sourceMode, sourceRefs: input.sourceRefs, listingUrl: input.listingUrl,
        employerCountry: input.employerCountry, workLocationCountry: input.workLocationCountry, employerMarket, workplaceType: input.workplaceType,
        geography: {
          residenceEligibility: eligibility.status, evidence: eligibility.reasons,
          workLocation: input.location ?? null, workLocationCountry: input.workLocationCountry, employerCountry: input.employerCountry,
          employmentModel: /contractor|contract|pj/i.test(input.description ?? "") ? "CONTRACTOR_MENTIONED" : "UNKNOWN",
          employerOfRecord: /employer of record|\beor\b/i.test(input.description ?? "") ? "EOR_MENTIONED" : "UNKNOWN",
          relocation: eligibility.status === "RELOCATION_REQUIRED",
          visaMentioned: /visa|work authorization|autorização de trabalho/i.test(input.description ?? ""),
          timezoneOverlapMentioned: /timezone|time zone|fuso horário|overlap/i.test(input.description ?? ""),
        },
      };
      const job = await prisma.jobListing.upsert({
        where: { source_externalId: { source: JobSource.AUTHORIZED_FEED, externalId: `${input.sourceKey}:${input.externalId ?? input.url}` } },
        update: { title: input.title, company: input.company, location: input.location, remote: input.remote ?? false, url: input.url, description: input.description ?? "", status: JobListingStatus.OPEN, rawData: sourceMetadata },
        create: { source: JobSource.AUTHORIZED_FEED, externalId: `${input.sourceKey}:${input.externalId ?? input.url}`, title: input.title, company: input.company, location: input.location, remote: input.remote ?? false, url: input.url, description: input.description ?? "", sourcePublishedAt: input.sourcePublishedAt && Number.isFinite(Date.parse(input.sourcePublishedAt)) ? new Date(input.sourcePublishedAt) : undefined, rawData: sourceMetadata },
      });
      const result = calculateMatch({ profileSkills: asStringArray(profile.skills), profileContext: context, jobTitle: job.title, jobDescription: job.description });
      const minimumMatchScore = preferences?.minimumMatchScore ?? 65;
      const displayedLabel = result.score >= minimumMatchScore ? result.label : `Abaixo do limite configurado (${minimumMatchScore}/100)`;
      const displayedRationale = result.score >= minimumMatchScore ? result.rationale : `${result.rationale} Abaixo do limiar configurado; mantida no banco para revisão, não priorizada como recomendação.`;
      const evidenceConfidence = Math.min(100, Math.round((job.description.length >= 1_000 ? 55 : job.description.length >= 250 ? 40 : 20) + Math.min(35, result.matchedSkills.length * 7)));
      const resumeReason = resumeRecommendation ? `${resumeRecommendation.reason} ${availableResume ? `Documento autorizado ${availableResume.version}, hash ${availableResume.sha256.slice(0, 12)}…` : "Documento autorizado ainda não importado; seleção bloqueada."}` : null;
      await prisma.jobMatch.upsert({
        where: { profileId_jobId: { profileId: profile.id, jobId: job.id } },
        update: { score: result.score, scoreVersion: result.scoreVersion, scoreBreakdown: result.scoreBreakdown, label: displayedLabel, matchedSkills: result.matchedSkills, skillGaps: result.skillGaps, rationale: displayedRationale, ragContext: context.slice(0, 10000), eligibilityStatus: eligibility.status, eligibilityReasons: eligibility.reasons, evidenceConfidence, recommendedResumeId: availableResume?.id ?? null, recommendedResumeReason: resumeReason },
        create: { profileId: profile.id, jobId: job.id, score: result.score, scoreVersion: result.scoreVersion, scoreBreakdown: result.scoreBreakdown, label: displayedLabel, matchedSkills: result.matchedSkills, skillGaps: result.skillGaps, rationale: displayedRationale, ragContext: context.slice(0, 10000), eligibilityStatus: eligibility.status, eligibilityReasons: eligibility.reasons, evidenceConfidence, recommendedResumeId: availableResume?.id ?? null, recommendedResumeReason: resumeReason },
      });
      for (const sourceRef of input.sourceRefs) persistedBySource.set(sourceRef.key, (persistedBySource.get(sourceRef.key) ?? 0) + 1);
      matches.push({ id: job.id, title: job.title, company: job.company, location: job.location, url: job.url, description: job.description, ...result, label: displayedLabel, rationale: displayedRationale, eligibilityStatus: eligibility.status, eligibilityReasons: eligibility.reasons, sourceName: input.attributionName, sourceUrl: input.listingUrl ?? input.attributionUrl, recommendedResume: availableResume?.originalName ?? null, recommendedResumeReason: resumeReason });
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

    const sorted = matches.sort((left, right) => right.score - left.score).slice(0, 30);
    const sourceErrors = search.sourceResults.filter((source) => source.status === "ERROR").length;
    const activeSources = search.sourceResults.filter((source) => source.status !== "NOT_SELECTED");
    const status = activeSources.length > 0 && sourceErrors === activeSources.length ? SearchRunStatus.FAILED : sourceErrors > 0 ? SearchRunStatus.PARTIAL_SUCCESS : SearchRunStatus.COMPLETED;
    const message = search.jobs.length
      ? "Busca concluída nas fontes selecionadas. Confira origem, descrição original e elegibilidade antes de preparar cada candidatura."
      : activeSources.length > 0 && sourceErrors === activeSources.length ? "Todas as fontes selecionadas falharam nesta execução." : "As fontes selecionadas responderam, mas não retornaram vagas compatíveis com os filtros de engenharia.";
    const sourceResults = search.sourceResults.map((source) => ({ ...source, persisted: persistedBySource.get(source.sourceKey) ?? 0 }));
    await prisma.careerSearchRun.update({ where: { id: run.id }, data: { status, queryCount: search.queryCount, resultCount: search.jobs.length, savedCount: matches.length, discardedCount: Math.max(0, search.sourceResults.reduce((sum, source) => sum + source.found, 0) - matches.length), errorCount: sourceErrors, sourceResults: sourceResults as unknown as Prisma.InputJsonValue, parameters: { targetTitles, locations, sourceKeys, employerMarkets, minimumMatchScore: preferences?.minimumMatchScore ?? 65, remoteOnly: preferences?.remoteOnly ?? false }, errorMessage: sourceErrors || !search.jobs.length ? message : null, completedAt: new Date() } });
    if (status === SearchRunStatus.FAILED) throw new Error(message);
    return { runId: run.id, matches: sorted, queries: search.queryCount, discovered: search.jobs.length, message };
  } catch (error) {
    await prisma.careerSearchRun.update({ where: { id: run.id }, data: { status: SearchRunStatus.FAILED, errorMessage: error instanceof Error ? error.message : "Erro desconhecido", completedAt: new Date() } });
    throw error;
  }
}

export async function getCareerDashboardData() {
  const profile = await getOrCreateProfile();
  const matches = await prisma.jobMatch.findMany({ where: { profileId: profile.id }, include: { job: true, recommendedResume: { select: { id: true, resumeKey: true, originalName: true, profileType: true, language: true, version: true, sha256: true } } }, orderBy: [{ score: "desc" }, { createdAt: "desc" }], take: 30 });
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
    update: { score: result.score, scoreVersion: result.scoreVersion, scoreBreakdown: result.scoreBreakdown, label: result.label, matchedSkills: result.matchedSkills, skillGaps: result.skillGaps, rationale: result.rationale, ragContext: context.slice(0, 10000) },
    create: { profileId: profile.id, jobId: job.id, score: result.score, scoreVersion: result.scoreVersion, scoreBreakdown: result.scoreBreakdown, label: result.label, matchedSkills: result.matchedSkills, skillGaps: result.skillGaps, rationale: result.rationale, ragContext: context.slice(0, 10000) },
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

export function linkedinSearchQueries(targetTitles: string[] = [...TARGET_JOB_TITLES], locations: string[] = [...SEARCH_LOCATIONS]) {
  return targetTitles.flatMap((title) => locations.map((location) => ({ title, location, url: searchUrl(title, location) })));
}
