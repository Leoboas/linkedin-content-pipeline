import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { buildApplicationKitPdf } from "@/lib/career-application-kit-documents";

const TOKEN_TTL_MS = 30 * 60 * 1000;
const browserStates = new Set(["BROWSER_QUEUED", "BROWSER_READY", "BROWSER_FILLING", "BROWSER_FILLED", "BROWSER_SUBMITTING", "CONFIRMED", "NEEDS_ACTION", "UNCERTAIN"]);
type Json = Prisma.InputJsonValue;

function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function packageContentHash(kit: { id: string; version: number; documentSha256: string | null; tailoredResume: unknown; coverLetter: string; knownAnswers: unknown }) {
  return createHash("sha256").update(canonical({ kitId: kit.id, version: kit.version, documentSha256: kit.documentSha256, tailoredResume: kit.tailoredResume, coverLetter: kit.coverLetter, answers: kit.knownAnswers })).digest("hex");
}
function packageHash(kit: Parameters<typeof packageContentHash>[0], resume: Uint8Array, coverLetter: Uint8Array) {
  return createHash("sha256").update(packageContentHash(kit)).update(resume).update(coverLetter).digest("hex");
}
function requireUrl(value: string) { const url = new URL(value); if (url.protocol !== "https:") throw new Error("A candidatura deve usar uma URL HTTPS."); return url; }

export type BrowserExecutorPayload = {
  submissionId: string;
  destinationUrl: string;
  company: string | null;
  title: string;
  packageHash: string;
  answers: Record<string, unknown>;
  documents: { resume: { filename: string; base64: string }; coverLetter: { filename: string; base64: string } };
  submitMode: "AUTO_SUBMIT";
};

export async function authorizeBrowserSubmission(kitId: string, profileId: string) {
  const kit = await prisma.applicationKit.findFirst({ where: { id: kitId, application: { profileId } }, include: { application: { include: { job: true } } } });
  if (!kit) throw new Error("Kit não encontrado.");
  const latest = await prisma.applicationKit.findFirst({ where: { applicationId: kit.applicationId }, orderBy: { version: "desc" }, select: { id: true } });
  if (latest?.id !== kit.id || kit.reviewStatus !== "NEEDS_REVIEW") throw new Error("Apenas a versão mais recente ainda em revisão pode ser autorizada.");
  requireUrl(kit.application.job.url);
  const existing = await prisma.applicationSubmission.findUnique({ where: { kitId: kit.id }, select: { id: true, state: true, executorMode: true } });
  if (existing) return { submission: existing, activationToken: null as string | null };
  const activationToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const document = { language: kit.language, tailoredResume: kit.tailoredResume as never, coverLetter: kit.coverLetter, jobTitle: kit.application.job.title, company: kit.application.job.company, version: kit.version } as const;
  const [resume, coverLetter] = await Promise.all([buildApplicationKitPdf(document, "resume"), buildApplicationKitPdf(document, "cover")]);
  const digest = packageHash(kit, resume, coverLetter);
  const submission = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "JobApplication" WHERE id = ${kit.applicationId}::uuid FOR UPDATE`;
    const current = await tx.applicationKit.findUnique({ where: { id: kit.id } });
    const currentLatest = await tx.applicationKit.findFirst({ where: { applicationId: kit.applicationId }, orderBy: { version: "desc" }, select: { id: true } });
    const active = await tx.applicationSubmission.findFirst({ where: { applicationId: kit.applicationId, state: { in: ["BROWSER_QUEUED", "BROWSER_READY", "BROWSER_FILLING", "BROWSER_FILLED", "BROWSER_SUBMITTING", "UNCERTAIN", "CONFIRMED"] } }, select: { id: true } });
    if (!current || current.reviewStatus !== "NEEDS_REVIEW" || currentLatest?.id !== kit.id) throw new Error("O pacote mudou; atualize a revisão antes de autorizar.");
    if (active) throw new Error("Esta vaga já possui uma execução de navegador ativa, incerta ou confirmada.");
    const created = await tx.applicationSubmission.create({ data: {
      applicationId: kit.applicationId, kitId: kit.id, destinationUrl: kit.application.job.url,
      formSnapshot: { portal: requireUrl(kit.application.job.url).hostname, reviewedAt: new Date().toISOString(), submitMode: "AUTO_SUBMIT" } as Json,
      answersSnapshot: kit.knownAnswers as Json, resumePdf: new Uint8Array(resume), coverLetterPdf: new Uint8Array(coverLetter), packageHash: digest,
      executorMode: "ASSISTED_BROWSER", executorTokenHash: tokenHash(activationToken), executorTokenExpiresAt: expiresAt, state: "BROWSER_QUEUED",
    } });
    await tx.applicationKit.update({ where: { id: kit.id }, data: { reviewStatus: "APPROVED" } });
    await tx.jobApplication.update({ where: { id: kit.applicationId }, data: { preparationStatus: "APPROVED_FOR_SUBMISSION" } });
    await tx.jobApplicationEvent.create({ data: { applicationId: kit.applicationId, eventType: "KIT_APPROVED", source: "USER", note: `Preenchimento no Chrome autorizado para Application Kit v${kit.version}.`, details: { submissionId: created.id, packageHash: digest, executor: "ASSISTED_BROWSER" } } });
    return created;
  }, { timeout: 60000, maxWait: 15000 });
  try { await inngest.send({ id: `browser-application:${submission.id}`, name: "career/application.browser.requested", data: { submissionId: submission.id } }); } catch { /* Durable outbox worker can recover BROWSER_QUEUED. */ }
  return { submission: { id: submission.id, state: submission.state, executorMode: submission.executorMode }, activationToken };
}

async function findByToken(token: string) {
  if (!token || token.length < 32) throw new Error("Credencial da extensão inválida.");
  const submission = await prisma.applicationSubmission.findFirst({ where: { executorTokenHash: tokenHash(token), executorMode: "ASSISTED_BROWSER" }, include: { application: { include: { job: true } }, kit: true } });
  if (!submission || !submission.executorTokenExpiresAt || submission.executorTokenExpiresAt < new Date()) throw new Error("A autorização da extensão expirou. Revise e autorize novamente.");
  return submission;
}

export async function claimBrowserExecutor(token: string): Promise<BrowserExecutorPayload> {
  const record = await findByToken(token);
  if (!["BROWSER_QUEUED", "BROWSER_READY", "BROWSER_FILLING"].includes(record.state)) throw new Error("Esta autorização não está disponível para preenchimento.");
  const hash = packageHash(record.kit, record.resumePdf, record.coverLetterPdf);
  if (hash !== record.packageHash) throw new Error("O pacote aprovado foi alterado; é necessária uma nova revisão.");
  await prisma.applicationSubmission.update({ where: { id: record.id }, data: { state: "BROWSER_FILLING", executorClaimedAt: new Date(), executorAttempt: { increment: 1 }, reason: null } });
  return { submissionId: record.id, destinationUrl: record.destinationUrl, company: record.application.job.company, title: record.application.job.title, packageHash: record.packageHash, answers: record.answersSnapshot as Record<string, unknown>, documents: { resume: { filename: "curriculo.pdf", base64: Buffer.from(record.resumePdf).toString("base64") }, coverLetter: { filename: "carta-apresentacao.pdf", base64: Buffer.from(record.coverLetterPdf).toString("base64") } }, submitMode: "AUTO_SUBMIT" };
}

export async function reportBrowserExecutor(token: string, input: { state: string; evidence?: Record<string, unknown>; reason?: string }) {
  const record = await findByToken(token);
  if (!browserStates.has(input.state)) throw new Error("Estado da extensão inválido.");
  const allowed: Record<string, string[]> = { BROWSER_QUEUED: ["BROWSER_READY", "BROWSER_FILLING", "NEEDS_ACTION"], BROWSER_READY: ["BROWSER_FILLING", "NEEDS_ACTION"], BROWSER_FILLING: ["BROWSER_FILLED", "BROWSER_SUBMITTING", "NEEDS_ACTION", "UNCERTAIN"], BROWSER_FILLED: ["BROWSER_SUBMITTING", "NEEDS_ACTION"], BROWSER_SUBMITTING: ["CONFIRMED", "UNCERTAIN", "NEEDS_ACTION"] };
  if (record.state !== input.state && !allowed[record.state]?.includes(input.state)) throw new Error("Transição da extensão não permitida.");
  const safeReason = input.reason?.slice(0, 400) ?? null;
  await prisma.$transaction(async (tx) => {
    await tx.applicationSubmission.update({ where: { id: record.id }, data: { state: input.state, reason: safeReason, executorEvidence: (input.evidence ?? null) as Json, executorCompletedAt: ["CONFIRMED", "NEEDS_ACTION", "UNCERTAIN"].includes(input.state) ? new Date() : undefined, ...(input.state === "BROWSER_SUBMITTING" ? { submittingAt: new Date() } : {}), ...(input.state === "CONFIRMED" ? { confirmedAt: new Date(), portalReceipt: typeof input.evidence?.receipt === "string" ? input.evidence.receipt.slice(0, 200) : "Browser confirmation detected" } : {}) } });
    if (input.state === "CONFIRMED") {
      await tx.jobApplication.update({ where: { id: record.applicationId }, data: { status: "APPLIED", preparationStatus: "SUBMITTING", appliedAt: new Date(), submissionEvidence: typeof input.evidence?.receipt === "string" ? input.evidence.receipt.slice(0, 400) : "Confirmação detectada pelo navegador", submissionEvidenceAt: new Date() } });
      await tx.jobApplicationEvent.create({ data: { applicationId: record.applicationId, eventType: "RECRUITMENT_STATUS_CHANGED", fromRecruitmentStage: "SAVED", toRecruitmentStage: "APPLIED", source: "BROWSER_EXTENSION", note: "Envio confirmado pela página do portal.", details: { submissionId: record.id, evidence: input.evidence ?? {} } as Prisma.InputJsonValue } });
    } else if (["NEEDS_ACTION", "UNCERTAIN"].includes(input.state)) {
      await tx.jobApplication.update({ where: { id: record.applicationId }, data: { preparationStatus: "MANUAL_ACTION_REQUIRED" } });
    }
  });
  return { id: record.id, state: input.state };
}

export async function markBrowserExecutorReady(id: string) {
  await prisma.applicationSubmission.updateMany({ where: { id, executorMode: "ASSISTED_BROWSER", state: "BROWSER_QUEUED" }, data: { state: "BROWSER_READY", reason: "Aguardando a extensão Chrome no portal oficial." } });
  return { submissionId: id };
}
