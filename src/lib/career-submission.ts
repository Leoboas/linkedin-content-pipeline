import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { buildApplicationKitPdf } from "@/lib/career-application-kit-documents";
import { LeverClient, type LeverAnswers, type LeverForm, validateLeverAnswers } from "@/lib/lever-application";

function lever(): LeverClient { return new LeverClient(process.env.LEVER_API_KEY ?? "", fetch, process.env.LEVER_SANDBOX === "true"); }
type SubmissionPortal = Pick<LeverClient, "inspect" | "upload" | "submit">;
function dryRun(): boolean {
  const enabled = process.env.CAREER_SUBMISSION_DRY_RUN === "true";
  if (enabled && process.env.LEVER_SANDBOX !== "true") throw new Error("O teste de envio exige LEVER_SANDBOX=true.");
  return enabled;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function hashPackage(form: LeverForm, answers: LeverAnswers, resume: Uint8Array, cover: Uint8Array): string {
  return createHash("sha256").update(canonicalJson({ form, answers })).update(resume).update(cover).digest("hex");
}
const reviewInclude = { application: { include: { job: true } } } as const;

export async function inspectSubmissionKit(kitId: string, profileId: string) {
  const kit = await prisma.applicationKit.findFirst({ where: { id: kitId, application: { profileId } }, include: reviewInclude });
  if (!kit) throw new Error("Kit não encontrado.");
  const latest = await prisma.applicationKit.findFirst({ where: { applicationId: kit.applicationId }, orderBy: { version: "desc" }, select: { id: true } });
  if (latest?.id !== kit.id || kit.reviewStatus !== "NEEDS_REVIEW") throw new Error("Apenas a versão mais recente em revisão pode ser enviada.");
  const form = await lever().inspect(kit.application.job.url, kit.application.job.title);
  return { form, company: kit.application.job.company, destinationUrl: kit.application.job.url, resume: kit.tailoredResume, coverLetter: kit.coverLetter, version: kit.version, dryRun: dryRun() };
}

export async function authorizeSubmission(kitId: string, profileId: string, expectedFormHash: string, answers: LeverAnswers, portal: SubmissionPortal = lever()) {
  const kit = await prisma.applicationKit.findFirst({ where: { id: kitId, application: { profileId } }, include: reviewInclude });
  if (!kit) throw new Error("Kit não encontrado.");
  const existing = await prisma.applicationSubmission.findUnique({ where: { kitId }, select: { id: true, state: true } });
  if (existing) return existing;
  const form = await portal.inspect(kit.application.job.url, kit.application.job.title);
  if (form.schemaHash !== expectedFormHash) throw new Error("O formulário mudou; atualize a revisão antes de autorizar.");
  validateLeverAnswers(form, answers);
  const document = { language: kit.language, tailoredResume: kit.tailoredResume as never, coverLetter: kit.coverLetter, jobTitle: kit.application.job.title, company: kit.application.job.company, version: kit.version } as const;
  const [resume, cover] = await Promise.all([buildApplicationKitPdf(document, "resume"), buildApplicationKitPdf(document, "cover")]);
  const digest = hashPackage(form, answers, resume, cover);
  try {
    return await prisma.$transaction(async (tx) => {
      // Lock the application row so authorization and concurrent revisions serialize.
      await tx.$queryRaw`SELECT id FROM "JobApplication" WHERE id = ${kit.applicationId}::uuid FOR UPDATE`;
      const duplicate = await tx.applicationSubmission.findUnique({ where: { kitId }, select: { id: true, state: true } });
      if (duplicate) return duplicate;
      const current = await tx.applicationKit.findUnique({ where: { id: kitId } });
      const latest = await tx.applicationKit.findFirst({ where: { applicationId: kit.applicationId }, orderBy: { version: "desc" }, select: { id: true } });
      const application = await tx.jobApplication.findUnique({ where: { id: kit.applicationId }, include: { job: true } });
      if (!current || current.reviewStatus !== "NEEDS_REVIEW" || latest?.id !== kitId || current.documentSha256 !== kit.documentSha256 || application?.job.url !== kit.application.job.url || application.job.title !== kit.application.job.title || application.status !== "SAVED") throw new Error("O pacote ou a vaga mudou; atualize a revisão.");
      const active = await tx.applicationSubmission.findFirst({ where: { applicationId: kit.applicationId, state: { in: ["QUEUED", "FILLING", "SUBMITTING", "UNCERTAIN", "CONFIRMED"] } } });
      if (active) throw new Error("Esta vaga já possui envio ativo, incerto ou confirmado.");
      const submission = await tx.applicationSubmission.create({ data: { applicationId: kit.applicationId, kitId, destinationUrl: kit.application.job.url, formSnapshot: form as unknown as Prisma.InputJsonValue, answersSnapshot: answers as Prisma.InputJsonValue, resumePdf: new Uint8Array(resume), coverLetterPdf: new Uint8Array(cover), packageHash: digest, dryRun: dryRun(), sandbox: process.env.LEVER_SANDBOX === "true" } });
      await tx.applicationKit.update({ where: { id: kitId }, data: { reviewStatus: "APPROVED" } });
      if (kit.resumeDraftId) await tx.resumeDraft.update({ where: { id: kit.resumeDraftId }, data: { status: "APPROVED" } });
      await tx.jobApplication.update({ where: { id: kit.applicationId }, data: { preparationStatus: "APPROVED_FOR_SUBMISSION" } });
      await tx.jobApplicationEvent.create({ data: { applicationId: kit.applicationId, eventType: "KIT_APPROVED", source: "USER", note: "Envio autorizado para esta vaga e versão do pacote.", details: { submissionId: submission.id, packageHash: digest } } });
      return { id: submission.id, state: submission.state };
    }, { timeout: 60000, maxWait: 15000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.applicationSubmission.findUnique({ where: { kitId }, select: { id: true, state: true } });
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

export async function dispatchSubmission(id: string): Promise<void> {
  const submission = await prisma.applicationSubmission.findUnique({ where: { id }, select: { id: true, state: true } });
  if (!submission || submission.state !== "QUEUED") return;
  // The database state remains the outbox; a scheduled sweeper redelivers missed events.
  await inngest.send({ name: "career/application.submit.requested", data: { submissionId: id } });
  await prisma.applicationSubmission.updateMany({ where: { id, state: "QUEUED" }, data: { dispatchedAt: new Date() } });
}

export async function processSubmission(id: string, portal?: SubmissionPortal) {
  const claimed = await prisma.applicationSubmission.updateMany({ where: { id, state: "QUEUED" }, data: { state: "FILLING", startedAt: new Date(), reason: null } });
  if (!claimed.count) return { status: "ALREADY_CLAIMED" };
  const record = await prisma.applicationSubmission.findUniqueOrThrow({ where: { id }, include: { application: { include: { job: true } }, kit: true } });
  const savedForm = record.formSnapshot as unknown as LeverForm;
  const answers = record.answersSnapshot as LeverAnswers;
  try {
    if ((process.env.LEVER_SANDBOX === "true") !== record.sandbox) throw new Error("O ambiente do portal mudou após a autorização.");
    if (record.packageHash !== hashPackage(savedForm, answers, record.resumePdf, record.coverLetterPdf)) throw new Error("A integridade do pacote aprovado não pôde ser confirmada.");
    const latest = await prisma.applicationKit.findFirst({ where: { applicationId: record.applicationId }, orderBy: { version: "desc" }, select: { id: true, reviewStatus: true } });
    if (latest?.id !== record.kitId || latest.reviewStatus !== "APPROVED" || record.application.job.url !== record.destinationUrl || record.application.status !== "SAVED") throw new Error("A vaga ou o pacote foi alterado; é necessária nova revisão.");
    const client = portal ?? lever();
    const liveForm = await client.inspect(record.destinationUrl, record.application.job.title);
    if (liveForm.schemaHash !== savedForm.schemaHash) throw new Error("O formulário mudou após a aprovação; revise as perguntas novamente.");
    validateLeverAnswers(savedForm, answers);
    const attachments: Record<string, string> = {};
    const values = Object.values(answers);
    if (values.includes("$resume")) attachments.$resume = await client.upload(Buffer.from(record.resumePdf), "curriculo.pdf");
    if (values.includes("$coverLetter")) attachments.$coverLetter = await client.upload(Buffer.from(record.coverLetterPdf), "carta.pdf");
    const finalForm = await client.inspect(record.destinationUrl, record.application.job.title);
    if (finalForm.schemaHash !== savedForm.schemaHash) throw new Error("O formulário mudou durante a preparação; revise novamente.");
    if (record.dryRun) {
      if (process.env.LEVER_SANDBOX !== "true") throw new Error("O teste só pode usar o ambiente sandbox do Lever.");
      await prisma.applicationSubmission.updateMany({ where: { id, state: "FILLING" }, data: { state: "TEST_PASSED", reason: "Formulário e anexos validados; nenhum envio foi realizado." } });
      return { status: "TEST_PASSED" };
    }
    // Persist before sending: a crash or timeout after this point must never automatically resend.
    const ready = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "JobApplication" WHERE id = ${record.applicationId}::uuid FOR UPDATE`;
      const current = await tx.applicationKit.findFirst({ where: { applicationId: record.applicationId }, orderBy: { version: "desc" }, select: { id: true, reviewStatus: true } });
      if (current?.id !== record.kitId || current.reviewStatus !== "APPROVED") return false;
      const transition = await tx.applicationSubmission.updateMany({ where: { id, state: "FILLING" }, data: { state: "SUBMITTING", submittingAt: new Date() } });
      return transition.count === 1;
    }, { timeout: 60000, maxWait: 15000 });
    if (!ready) return { status: "STOPPED" };
    try {
      const receipt = await client.submit(savedForm, answers, attachments);
      await prisma.$transaction(async (tx) => {
        await tx.applicationSubmission.update({ where: { id }, data: { state: "CONFIRMED", portalReceipt: receipt, confirmedAt: new Date() } });
        await tx.jobApplication.update({ where: { id: record.applicationId }, data: { status: "APPLIED", appliedAt: new Date(), submissionEvidence: `Lever applicationId: ${receipt}`, submissionEvidenceAt: new Date() } });
        await tx.jobApplicationEvent.create({ data: { applicationId: record.applicationId, eventType: "RECRUITMENT_STATUS_CHANGED", fromRecruitmentStage: record.application.status, toRecruitmentStage: "APPLIED", source: "LEVER", note: "Envio confirmado pelo portal.", details: { submissionId: id, receipt } } });
      }, { timeout: 60000, maxWait: 15000 });
      return { status: "CONFIRMED" };
    } catch {
      await prisma.applicationSubmission.updateMany({ where: { id, state: "SUBMITTING" }, data: { state: "UNCERTAIN", reason: "O portal não confirmou o resultado. Verifique o portal antes de qualquer nova tentativa." } });
      return { status: "UNCERTAIN" };
    }
  } catch (error) {
    await prisma.applicationSubmission.updateMany({ where: { id, state: "FILLING" }, data: { state: "NEEDS_ACTION", reason: error instanceof Error ? error.message.slice(0, 400) : "Falha na preparação do envio." } });
    return { status: "NEEDS_ACTION" };
  }
}
