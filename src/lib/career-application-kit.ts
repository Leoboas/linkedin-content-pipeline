import { createHash } from "node:crypto";
import { ApplicationPreparationStatus, ApplicationKitReviewStatus, JobApplicationEventType, ResumeDraftStatus, Prisma, type AuthorizedResumeLanguage } from "@prisma/client";
import { generateTextWithFallback } from "@/lib/ai-provider";
import { prisma } from "@/lib/prisma";
import { normalizeSkills, extractSkillsFromText } from "@/lib/skills-normalizer";
import { recommendAuthorizedResume } from "../../config/authorized-resumes";
import { isCandidateResumeKey, resumeMatchesBaseKey } from "@/lib/authorized-resume-versioning";

type ResumeExperience = { role: string; company: string; period: string; bullets: string[] };
type TailoredResume = {
  headline: string;
  summary: string;
  skills: Array<{ category: string; items: string[] }>;
  experience: ResumeExperience[];
  projects: Array<{ name: string; description: string; stack: string[] }>;
  education: string[];
  languages: string[];
  keywords: string[];
};

const REQUIRED_CONFIRMATIONS = [
  "Pretensão salarial",
  "Autorização de trabalho e necessidade de visto",
  "Disponibilidade para início",
  "Disponibilidade para realocação",
  "Respostas específicas do formulário do empregador",
];

function parseJson(raw: string): Record<string, unknown> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try { return JSON.parse(cleaned) as Record<string, unknown>; }
  catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("O provedor não retornou JSON estruturado para o Application Kit.");
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  }
}

function asText(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function asList(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean) : []; }
function asRecords(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object") : []; }
function normalized(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("en-US"); }

function parseResume(value: Record<string, unknown>, sourceText: string): TailoredResume {
  const source = normalized(sourceText);
  const skills = new Set(normalizeSkills(extractSkillsFromText(sourceText)).map(normalized));
  const assertSupportedTerms = (text: string, section: string) => {
    const unsupported = extractSkillsFromText(text).filter((skill) => !skills.has(normalized(skill)));
    if (unsupported.length) throw new Error(`${section} contains unverified technologies: ${unsupported.join(", ")}.`);
  };
  const experience = asRecords(value.experience).map((item) => ({
    role: asText(item.role), company: asText(item.company), period: asText(item.period), bullets: asList(item.bullets),
  })).filter((item) => item.role || item.company);
  const projects = asRecords(value.projects).map((item) => ({ name: asText(item.name), description: asText(item.description), stack: normalizeSkills(asList(item.stack)) }))
    .filter((item) => item.name || item.description);
  for (const entry of experience) {
    if ((entry.role && !source.includes(normalized(entry.role))) || (entry.company && !source.includes(normalized(entry.company)))) {
      throw new Error("O rascunho introduziu cargo ou empregador que não aparece no currículo-base autorizado.");
    }
  }
  for (const project of projects) if (project.name && !source.includes(normalized(project.name))) throw new Error("O rascunho introduziu projeto ausente do currículo-base autorizado.");
  for (const entry of experience) {
    if (entry.period && !source.includes(normalized(entry.period))) throw new Error("Experience period is not supported by the authorized resume.");
    for (const bullet of entry.bullets) assertSupportedTerms(bullet, "Experience bullet");
  }
  for (const project of projects) {
    assertSupportedTerms(project.description, "Project description");
    project.stack = project.stack.filter((skill) => skills.has(normalized(skill)));
  }
  const normalizedSkills = asRecords(value.skills).map((item) => ({
    category: asText(item.category) || "Core Skills",
    items: normalizeSkills(asList(item.items)).filter((skill) => skills.has(normalized(skill))),
  })).filter((group) => group.items.length);
  const candidate = {
    headline: asText(value.headline), summary: asText(value.summary), skills: normalizedSkills, experience,
    projects, education: asList(value.education), languages: asList(value.languages), keywords: normalizeSkills(asList(value.keywords)),
  };
  assertSupportedTerms(candidate.headline, "Resume headline");
  assertSupportedTerms(candidate.summary, "Resume summary");
  const numericClaims = JSON.stringify(candidate).match(/(?:\b\d+(?:[.,]\d+)?\s?%|\bR\$\s?\d[\d.,]*|\bUSD\s?\d[\d.,]*|\b\d{4}\b)/giu) ?? [];
  if (numericClaims.some((claim) => !source.includes(normalized(claim)))) throw new Error("O rascunho incluiu uma métrica ou data não encontrada no currículo-base; nenhum kit foi aprovado.");
  return candidate;
}

async function updatePreparation(applicationId: string, status: ApplicationPreparationStatus, input: { requestKey: string; note?: string; source?: string }) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.jobApplication.findUnique({ where: { id: applicationId }, select: { preparationStatus: true } });
    if (!current) throw new Error("Oportunidade da fila não encontrada.");
    await tx.jobApplication.update({ where: { id: applicationId }, data: { preparationStatus: status } });
    await tx.jobApplicationEvent.upsert({
      where: { idempotencyKey: `prep:${input.requestKey}:${status}` },
      create: { applicationId, eventType: JobApplicationEventType.PREPARATION_STATUS_CHANGED, fromPreparationStage: current.preparationStatus, toPreparationStage: status, source: input.source ?? "INNGEST", note: input.note, idempotencyKey: `prep:${input.requestKey}:${status}` },
      update: {},
    });
  });
}

export async function prepareApplicationKit(applicationId: string, requestKey: string) {
  const existingKit = await prisma.applicationKit.findUnique({ where: { requestKey }, select: { id: true, reviewStatus: true, version: true } });
  if (existingKit) return { kitId: existingKit.id, reviewStatus: existingKit.reviewStatus, version: existingKit.version, duplicate: true };

  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { profile: true, job: true, authorizedResume: true, resumeDraft: true },
  });
  if (!application) throw new Error("Oportunidade da fila não encontrada.");

  await updatePreparation(applicationId, ApplicationPreparationStatus.PREPARING, { requestKey });
  const preferred = application.authorizedResume && isCandidateResumeKey(application.authorizedResume.resumeKey)
    ? application.authorizedResume
    : null;
  const recommendation = recommendAuthorizedResume({ title: application.job.title, description: application.job.description, languageHint: /portugu[eê]s|brazil|brasil/iu.test(`${application.job.title} ${application.job.description} ${application.job.location ?? ""}`) ? "PT_BR" : "EN" });
  const authorizedResumes = preferred ? [preferred] : await prisma.authorizedResume.findMany({ where: { profileId: application.profileId }, orderBy: { updatedAt: "desc" } });
  const baseResume = preferred ?? (recommendation ? authorizedResumes.find((resume) => isCandidateResumeKey(resume.resumeKey) && resumeMatchesBaseKey(resume.resumeKey, recommendation.resumeKey)) : null);
  if (!baseResume) {
    await updatePreparation(applicationId, ApplicationPreparationStatus.NEEDS_INFORMATION, { requestKey, note: "Importe um dos quatro currículos V2; os PDFs históricos são apenas referências." });
    return { kitId: null, reviewStatus: ApplicationKitReviewStatus.NEEDS_INFORMATION, version: null, missing: "AUTHORIZED_RESUME" };
  }

  const sourceDocument = await prisma.careerDocument.findFirst({
    where: { profileId: application.profileId, sourceUrl: `authorized-resume://${application.profileId}/${baseResume.resumeKey}` },
    select: { content: true },
  });
  if (!sourceDocument?.content?.trim()) {
    await updatePreparation(applicationId, ApplicationPreparationStatus.NEEDS_INFORMATION, { requestKey, note: "O conteúdo extraído do currículo autorizado está ausente; reimporte o documento pela biblioteca." });
    return { kitId: null, reviewStatus: ApplicationKitReviewStatus.NEEDS_INFORMATION, version: null, missing: "RESUME_TEXT" };
  }

  const profileFacts = await prisma.professionalFact.findMany({
    where: { publicAllowed: true, visibility: "PUBLIC_SAFE", evidenceStatus: { in: ["VERIFIED", "DOCUMENTED", "USER_CONFIRMED"] }, implementationStatus: { in: ["IMPLEMENTED", "USED_IN_PORTFOLIO"] } },
    select: { claim: true }, take: 40,
  });
  const profileFactsText = profileFacts.map((fact) => fact.claim).filter((claim) => normalized(sourceDocument.content).includes(normalized(claim)));
  const sourceText = [sourceDocument.content, application.profile.headline, application.profile.about, ...asList(application.profile.skills), ...profileFactsText].filter(Boolean).join("\n");
  const language: AuthorizedResumeLanguage = baseResume.language;
  const roleLanguage = language === "EN" ? "English" : "Brazilian Portuguese";
  const promptInput = {
    role: application.job.title, company: application.job.company, location: application.job.location,
    jobDescription: application.job.description.slice(0, 16_000), authorizedResume: sourceDocument.content.slice(0, 24_000),
    verifiedProfile: { headline: application.profile.headline, about: application.profile.about, skills: asList(application.profile.skills), evidence: profileFactsText },
    outputLanguage: roleLanguage,
  };

  let generated: Record<string, unknown>;
  try {
    const response = await generateTextWithFallback({
      model: process.env.RESUME_BUILDER_MODEL || "gemini-3.6-flash", temperature: 0.15, max_tokens: 3200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: [
          "You are a senior technical recruiter and ATS resume editor. Return only strict JSON.",
          `Write in ${roleLanguage}. Use only facts explicitly present in authorizedResume or verifiedProfile.`,
          "Never create employers, job titles, dates, metrics, certifications, technologies, projects, or achievements.",
          "Tailor by reordering and concise paraphrase only. Skills must be a subset of the provided resume. Preserve factual meaning and seniority.",
          "Create a specific, restrained cover letter based on the actual job description and verified facts; do not claim personal knowledge of the company.",
          "Unknown salary, work authorization, visa, availability, relocation, and form answers must remain unanswered and be listed in requiredConfirmations.",
          "JSON shape: {headline,summary,skills:[{category,items:string[]}],experience:[{role,company,period,bullets:string[]}],projects:[{name,description,stack:string[]}],education:string[],languages:string[],keywords:string[],coverLetter:string,knownAnswers:[{question,answer,source}],unverifiedRequirements:string[],requiredConfirmations:string[]}",
        ].join(" ") },
        { role: "user", content: JSON.stringify(promptInput) },
      ],
    });
    const raw = response.choices[0]?.message.content;
    if (!raw) throw new Error("O gerador não retornou um kit estruturado.");
    generated = parseJson(raw);
  } catch (error) {
    await updatePreparation(applicationId, ApplicationPreparationStatus.SUBMISSION_FAILED, { requestKey, note: error instanceof Error ? error.message.slice(0, 500) : "Falha de geração." });
    throw error;
  }

  let tailoredResume: TailoredResume;
  try { tailoredResume = parseResume(generated, sourceText); }
  catch (error) {
    await updatePreparation(applicationId, ApplicationPreparationStatus.NEEDS_INFORMATION, { requestKey, note: error instanceof Error ? error.message : "Revisão factual necessária." });
    return { kitId: null, reviewStatus: ApplicationKitReviewStatus.NEEDS_INFORMATION, version: null, missing: "FACTUAL_VALIDATION" };
  }
  const coverLetter = asText(generated.coverLetter);
  if (coverLetter.length < 120) {
    await updatePreparation(applicationId, ApplicationPreparationStatus.NEEDS_INFORMATION, { requestKey, note: "A carta gerada está incompleta; revise ou regenere o kit." });
    return { kitId: null, reviewStatus: ApplicationKitReviewStatus.NEEDS_INFORMATION, version: null, missing: "COVER_LETTER" };
  }
  const verifiedSkillSet = new Set(normalizeSkills(extractSkillsFromText(sourceText)).map(normalized));
  const unsupportedCoverSkills = extractSkillsFromText(coverLetter).filter((skill) => !verifiedSkillSet.has(normalized(skill)));
  const unsupportedCoverNumbers = coverLetter.match(/(?:\b\d+(?:[.,]\d+)?\s?%|\bR\$\s?\d[\d.,]*|\bUSD\s?\d[\d.,]*|\b\d{4}\b)/giu) ?? [];
  if (unsupportedCoverSkills.length || unsupportedCoverNumbers.some((claim) => !normalized(sourceText).includes(normalized(claim)))) {
    await updatePreparation(applicationId, ApplicationPreparationStatus.NEEDS_INFORMATION, { requestKey, note: "A cover letter inclui tecnologia, mÃ©trica ou data sem suporte no currÃ­culo; nenhum kit foi aprovado." });
    return { kitId: null, reviewStatus: ApplicationKitReviewStatus.NEEDS_INFORMATION, version: null, missing: "COVER_LETTER_FACT_CHECK" };
  }

  const knownAnswers = asRecords(generated.knownAnswers).filter((answer) => {
    const value = asText(answer.answer);
    return value.length > 0 && normalized(sourceText).includes(normalized(value));
  }).map((answer) => ({ question: asText(answer.question), answer: asText(answer.answer), source: asText(answer.source) || "Currículo autorizado" }));
  const unverifiedRequirements = asList(generated.unverifiedRequirements).slice(0, 30);
  const requiredConfirmations = [...new Set([...REQUIRED_CONFIRMATIONS, ...asList(generated.requiredConfirmations)])].slice(0, 30);
  const submissionChecklist = ["Revisar currículo adaptado", "Revisar e aprovar a cover letter", "Confirmar salário, autorização de trabalho, visto, disponibilidade e realocação", "Responder às perguntas específicas do empregador", "Enviar manualmente no portal oficial", "Registrar a confirmação de envio no CRM"];
  const version = await prisma.applicationKit.count({ where: { applicationId } }).then((count) => count + 1);
  const contentHash = createHash("sha256").update(JSON.stringify({ tailoredResume, coverLetter, knownAnswers, unverifiedRequirements, requiredConfirmations })).digest("hex");

  const result = await prisma.$transaction(async (tx) => {
    const resumeDraft = await tx.resumeDraft.create({
      data: {
        profileId: application.profileId, sourceJobId: application.jobId, targetRole: application.job.title,
        template: baseResume.profileType === "DATA_ENGINEERING" ? "ats-data" : "ats-tech",
        jobDescription: application.job.description, content: tailoredResume as unknown as Prisma.InputJsonValue,
        validation: { sourceResumeId: baseResume.id, sourceResumeSha256: baseResume.sha256, applicationKitRequestKey: requestKey, warnings: ["Rascunho gerado para revisão humana; não enviar automaticamente."] },
        status: "AWAITING_REVIEW",
      },
    });
    const kit = await tx.applicationKit.create({
      data: {
        applicationId, requestKey, version, baseResumeId: baseResume.id, resumeDraftId: resumeDraft.id, language,
        tailoredResume: tailoredResume as unknown as Prisma.InputJsonValue, coverLetter,
        knownAnswers: knownAnswers as unknown as Prisma.InputJsonValue,
        unverifiedRequirements: unverifiedRequirements as unknown as Prisma.InputJsonValue,
        requiredConfirmations: requiredConfirmations as unknown as Prisma.InputJsonValue,
        submissionChecklist: submissionChecklist as unknown as Prisma.InputJsonValue,
        reviewStatus: ApplicationKitReviewStatus.NEEDS_REVIEW, documentSha256: contentHash,
      },
    });
    await tx.jobApplication.update({ where: { id: applicationId }, data: { authorizedResumeId: baseResume.id, resumeDraftId: resumeDraft.id, preparationStatus: ApplicationPreparationStatus.READY_FOR_REVIEW } });
    await tx.jobApplicationEvent.create({ data: { applicationId, eventType: JobApplicationEventType.KIT_CREATED, fromPreparationStage: ApplicationPreparationStatus.PREPARING, toPreparationStage: ApplicationPreparationStatus.READY_FOR_REVIEW, source: "INNGEST", note: `Application Kit v${version} criado; revisão humana obrigatória.`, idempotencyKey: `kit-created:${requestKey}` } });
    await tx.jobApplicationEvent.upsert({
      where: { idempotencyKey: `prep:${requestKey}:${ApplicationPreparationStatus.READY_FOR_REVIEW}` },
      create: { applicationId, eventType: JobApplicationEventType.PREPARATION_STATUS_CHANGED, fromPreparationStage: ApplicationPreparationStatus.PREPARING, toPreparationStage: ApplicationPreparationStatus.READY_FOR_REVIEW, source: "INNGEST", idempotencyKey: `prep:${requestKey}:${ApplicationPreparationStatus.READY_FOR_REVIEW}` },
      update: {},
    });
    return kit;
  });
  return { kitId: result.id, reviewStatus: result.reviewStatus, version: result.version, duplicate: false };
}

export async function reviseApplicationKit(input: { kitId: string; profileId: string; coverLetter?: string; tailoredResume?: unknown }) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.applicationKit.findFirst({ where: { id: input.kitId, application: { profileId: input.profileId } }, include: { application: { select: { profileId: true, jobId: true, job: { select: { title: true, description: true } } } }, baseResume: { select: { resumeKey: true, profileType: true, sha256: true } } } });
    if (!current) throw new Error("Application Kit não encontrado.");
    await tx.$queryRaw`SELECT id FROM "JobApplication" WHERE id = ${current.applicationId}::uuid FOR UPDATE`;
    const inFlight = await tx.applicationSubmission.findFirst({ where: { applicationId: current.applicationId, state: { in: ["SUBMITTING", "UNCERTAIN", "CONFIRMED"] } }, select: { id: true } });
    if (inFlight) throw new Error("Não é possível alterar o pacote após o início do envio ou enquanto o resultado estiver incerto.");
    await tx.applicationSubmission.updateMany({ where: { applicationId: current.applicationId, state: { in: ["QUEUED", "FILLING"] } }, data: { state: "REVOKED", reason: "Pacote substituído por nova revisão." } });
    const currentResume = current.tailoredResume as unknown as TailoredResume;
    let nextResume = currentResume;
    if (input.tailoredResume && typeof input.tailoredResume === "object") {
      const source = current.baseResume ? await tx.careerDocument.findFirst({ where: { profileId: input.profileId, sourceUrl: `authorized-resume://${input.profileId}/${current.baseResume.resumeKey}` }, select: { content: true } }) : null;
      if (!source?.content) throw new Error("Currículo-base autorizado não encontrado para validar a revisão.");
      nextResume = parseResume(input.tailoredResume as Record<string, unknown>, source.content);
    }
    const nextCoverLetter = typeof input.coverLetter === "string" ? input.coverLetter.trim().slice(0, 12_000) : current.coverLetter;
    if (nextCoverLetter.length < 120) throw new Error("A cover letter deve ter pelo menos 120 caracteres.");
    const sourceForClaims = current.baseResume ? await tx.careerDocument.findFirst({ where: { profileId: input.profileId, sourceUrl: `authorized-resume://${input.profileId}/${current.baseResume.resumeKey}` }, select: { content: true } }) : null;
    const numericClaims = nextCoverLetter.match(/(?:\b\d+(?:[.,]\d+)?\s?%|\bR\$\s?\d[\d.,]*|\bUSD\s?\d[\d.,]*|\b\d{4}\b)/giu) ?? [];
    if (numericClaims.some((claim) => !normalized(sourceForClaims?.content ?? "").includes(normalized(claim)))) throw new Error("A revisão da carta contém métrica ou data não comprovada no currículo autorizado.");
    const version = await tx.applicationKit.count({ where: { applicationId: current.applicationId } }) + 1;
    const requestKey = `manual-revision:${current.id}:${version}`;
    const hash = createHash("sha256").update(JSON.stringify({ nextResume, nextCoverLetter })).digest("hex");
    const nextResumeDraft = await tx.resumeDraft.create({ data: {
      profileId: current.application.profileId,
      sourceJobId: current.application.jobId,
      targetRole: current.application.job.title,
      template: current.baseResume?.profileType === "DATA_ENGINEERING" ? "ats-data" : "ats-tech",
      jobDescription: current.application.job.description,
      content: nextResume as unknown as Prisma.InputJsonValue,
      validation: { sourceResumeSha256: current.baseResume?.sha256 ?? null, parentApplicationKitId: current.id, applicationKitRequestKey: requestKey, warnings: ["Human review required; this version is not yet approved."] },
      status: ResumeDraftStatus.AWAITING_REVIEW,
    } });
    const next = await tx.applicationKit.create({ data: {
      applicationId: current.applicationId, requestKey, version, baseResumeId: current.baseResumeId, resumeDraftId: nextResumeDraft.id,
      language: current.language, tailoredResume: nextResume as unknown as Prisma.InputJsonValue, coverLetter: nextCoverLetter,
      knownAnswers: current.knownAnswers as Prisma.InputJsonValue, unverifiedRequirements: current.unverifiedRequirements as Prisma.InputJsonValue,
      requiredConfirmations: current.requiredConfirmations as Prisma.InputJsonValue, submissionChecklist: current.submissionChecklist as Prisma.InputJsonValue,
      reviewStatus: ApplicationKitReviewStatus.NEEDS_REVIEW, documentSha256: hash,
    } });
    await tx.jobApplication.update({ where: { id: current.applicationId }, data: { resumeDraftId: nextResumeDraft.id, preparationStatus: ApplicationPreparationStatus.READY_FOR_REVIEW } });
    await tx.jobApplicationEvent.create({ data: { applicationId: current.applicationId, eventType: JobApplicationEventType.PREPARATION_STATUS_CHANGED, fromPreparationStage: ApplicationPreparationStatus.READY_FOR_REVIEW, toPreparationStage: ApplicationPreparationStatus.READY_FOR_REVIEW, source: "USER", note: `Application Kit v${version} revisado; aprovação anterior não se aplica à nova versão.` } });
    return next;
  });
}

export async function approveApplicationKit(kitId: string, profileId: string) {
  return prisma.$transaction(async (tx) => {
    const kit = await tx.applicationKit.findFirst({ where: { id: kitId, application: { profileId } }, include: { application: { select: { id: true, preparationStatus: true } } } });
    if (!kit) throw new Error("Application Kit não encontrado.");
    if (kit.reviewStatus === ApplicationKitReviewStatus.APPROVED) return kit;
    if (kit.reviewStatus !== ApplicationKitReviewStatus.NEEDS_REVIEW) throw new Error("Only a kit awaiting review can be approved.");
    const latest = await tx.applicationKit.findFirst({ where: { applicationId: kit.applicationId }, orderBy: { version: "desc" }, select: { id: true } });
    if (latest?.id !== kit.id) throw new Error("This kit was superseded. Review and approve the latest version.");
    const updated = await tx.applicationKit.update({ where: { id: kit.id }, data: { reviewStatus: ApplicationKitReviewStatus.APPROVED } });
    if (kit.resumeDraftId) await tx.resumeDraft.update({ where: { id: kit.resumeDraftId }, data: { status: ResumeDraftStatus.APPROVED } });
    await tx.jobApplication.update({ where: { id: kit.applicationId }, data: { preparationStatus: ApplicationPreparationStatus.APPROVED_FOR_SUBMISSION } });
    await tx.jobApplicationEvent.create({ data: { applicationId: kit.applicationId, eventType: JobApplicationEventType.KIT_APPROVED, fromPreparationStage: kit.application.preparationStatus, toPreparationStage: ApplicationPreparationStatus.APPROVED_FOR_SUBMISSION, source: "USER", note: `Application Kit v${kit.version} aprovado; envio continua manual.` } });
    return updated;
  });
}
