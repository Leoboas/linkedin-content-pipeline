import { ApplicationPreparationStatus, JobApplicationEventType } from "@prisma/client";
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateProfile } from "@/lib/career-engine";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";

const activePreparation = new Set<ApplicationPreparationStatus>([
  ApplicationPreparationStatus.QUEUED,
  ApplicationPreparationStatus.PREPARING,
  ApplicationPreparationStatus.READY_FOR_REVIEW,
  ApplicationPreparationStatus.APPROVED_FOR_SUBMISSION,
]);
const retryablePreparation = new Set<ApplicationPreparationStatus>([
  ApplicationPreparationStatus.QUEUED,
  ApplicationPreparationStatus.SUBMISSION_FAILED,
  ApplicationPreparationStatus.NEEDS_INFORMATION,
]);
const terminalOrSubmitted = new Set(["APPLIED", "SCREENING", "INTERVIEW", "TECHNICAL_TEST", "OFFER", "REJECTED", "WITHDRAWN", "ARCHIVED"]);

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const profile = await getOrCreateProfile();
  const applications = await prisma.jobApplication.findMany({
    where: { profileId: profile.id },
    include: {
      job: { include: { matches: { where: { profileId: profile.id }, take: 1, include: { recommendedResume: { select: { id: true, originalName: true, version: true, sha256: true } } } } } },
      resumeDraft: { select: { id: true, targetRole: true, atsScore: true, status: true } },
      authorizedResume: { select: { id: true, originalName: true, version: true, language: true, sha256: true } },
      kits: { orderBy: { version: "desc" }, take: 5, select: { id: true, version: true, language: true, coverLetter: true, reviewStatus: true, documentSha256: true, createdAt: true, requiredConfirmations: true, unverifiedRequirements: true } },
      events: { orderBy: { createdAt: "desc" }, take: 30 },
    },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ applications: applications.map(({ job, ...application }) => {
    const latestMatch = job.matches[0];
    const { matches: _matches, ...jobData } = job;
    return { ...application, job: { ...jobData, score: latestMatch?.score ?? 0, label: latestMatch?.label ?? "Sem match", rationale: latestMatch?.rationale ?? "", eligibilityStatus: latestMatch?.eligibilityStatus ?? "UNKNOWN", eligibilityReasons: latestMatch?.eligibilityReasons ?? [], recommendedResume: latestMatch?.recommendedResume ?? null, recommendedResumeReason: latestMatch?.recommendedResumeReason ?? null } };
  }) });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  if (typeof body.jobId !== "string" || !/^[0-9a-f-]{36}$/iu.test(body.jobId)) return NextResponse.json({ error: "jobId inválido." }, { status: 400 });
  const queueNow = body.queue !== false;
  const profile = await getOrCreateProfile();
  const match = await prisma.jobMatch.findUnique({ where: { profileId_jobId: { profileId: profile.id, jobId: body.jobId } }, select: { recommendedResumeId: true } });
  const job = await prisma.jobListing.findUnique({ where: { id: body.jobId }, select: { id: true } });
  if (!job) return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 });

  const application = await prisma.$transaction(async (tx) => {
    const current = await tx.jobApplication.findUnique({ where: { profileId_jobId: { profileId: profile.id, jobId: job.id } } });
    if (!current) {
      const created = await tx.jobApplication.create({ data: {
        profileId: profile.id, jobId: job.id, status: "SAVED", authorizedResumeId: match?.recommendedResumeId ?? null,
        preparationStatus: queueNow ? ApplicationPreparationStatus.QUEUED : ApplicationPreparationStatus.NOT_QUEUED,
        preparationAttempt: queueNow ? 1 : 0,
      } });
      if (queueNow) await tx.jobApplicationEvent.create({ data: { applicationId: created.id, eventType: JobApplicationEventType.PREPARATION_STATUS_CHANGED, fromPreparationStage: ApplicationPreparationStatus.NOT_QUEUED, toPreparationStage: ApplicationPreparationStatus.QUEUED, source: "USER", idempotencyKey: `queue:${created.id}:1` } });
      return created;
    }
    if (!queueNow || activePreparation.has(current.preparationStatus) || terminalOrSubmitted.has(current.status)) return current;
    const attempt = current.preparationAttempt + 1;
    const updated = await tx.jobApplication.update({ where: { id: current.id }, data: { preparationStatus: ApplicationPreparationStatus.QUEUED, preparationAttempt: attempt, ...(match?.recommendedResumeId ? { authorizedResumeId: match.recommendedResumeId } : {}) } });
    await tx.jobApplicationEvent.create({ data: { applicationId: current.id, eventType: JobApplicationEventType.PREPARATION_STATUS_CHANGED, fromPreparationStage: current.preparationStatus, toPreparationStage: ApplicationPreparationStatus.QUEUED, source: "USER", idempotencyKey: `queue:${current.id}:${attempt}` } });
    return updated;
  });

  if (!queueNow || terminalOrSubmitted.has(application.status) || !retryablePreparation.has(application.preparationStatus)) {
    return NextResponse.json({ application, enqueued: false }, { status: 200 });
  }
  const requestKey = `application-kit:${application.id}:${application.preparationAttempt}`;
  try {
    await inngest.send({ id: requestKey, name: "career/application.prepare.requested", data: { applicationId: application.id, requestKey } });
    return NextResponse.json({ application, enqueued: true }, { status: 202 });
  } catch {
    return NextResponse.json({ application, enqueued: false, error: "A oportunidade foi salva na fila, mas o Inngest não confirmou o recebimento. Use Tentar novamente para reenfileirar." }, { status: 202 });
  }
}
