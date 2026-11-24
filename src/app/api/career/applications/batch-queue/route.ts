import { ApplicationPreparationStatus, JobApplicationEventType } from "@prisma/client";
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { getOrCreateProfile } from "@/lib/career-engine";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { prisma } from "@/lib/prisma";

const active = new Set<ApplicationPreparationStatus>([ApplicationPreparationStatus.QUEUED, ApplicationPreparationStatus.PREPARING, ApplicationPreparationStatus.READY_FOR_REVIEW, ApplicationPreparationStatus.APPROVED_FOR_SUBMISSION]);
const terminal = new Set(["APPLIED", "SCREENING", "INTERVIEW", "TECHNICAL_TEST", "OFFER", "REJECTED", "WITHDRAWN", "ARCHIVED"]);

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  let body: { applicationIds?: unknown };
  try { body = await request.json() as { applicationIds?: unknown }; }
  catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  if (!Array.isArray(body.applicationIds) || body.applicationIds.length < 1 || body.applicationIds.length > 25 || body.applicationIds.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/iu.test(id))) {
    return NextResponse.json({ error: "Envie de 1 a 25 IDs de candidaturas válidos." }, { status: 400 });
  }
  const profile = await getOrCreateProfile();
  const uniqueIds = [...new Set(body.applicationIds as string[])];
  let queued = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const id of uniqueIds) {
    const queuedApplication = await prisma.$transaction(async (tx) => {
      const application = await tx.jobApplication.findFirst({ where: { id, profileId: profile.id } });
      if (!application || terminal.has(application.status) || active.has(application.preparationStatus)) return null;
      const attempt = application.preparationAttempt + 1;
      const updated = await tx.jobApplication.update({ where: { id }, data: { preparationStatus: ApplicationPreparationStatus.QUEUED, preparationAttempt: attempt } });
      await tx.jobApplicationEvent.create({ data: { applicationId: id, eventType: JobApplicationEventType.PREPARATION_STATUS_CHANGED, fromPreparationStage: application.preparationStatus, toPreparationStage: ApplicationPreparationStatus.QUEUED, source: "USER", note: "Incluída manualmente na fila em lote.", idempotencyKey: `queue:${id}:${attempt}` } });
      return updated;
    });
    if (!queuedApplication) { skipped += 1; continue; }
    const requestKey = `application-kit:${id}:${queuedApplication.preparationAttempt}`;
    try {
      await inngest.send({ id: requestKey, name: "career/application.prepare.requested", data: { applicationId: id, requestKey } });
      queued += 1;
    } catch {
      errors.push(id);
    }
  }
  return NextResponse.json({ queued, skipped, enqueueFailures: errors }, { status: errors.length ? 202 : 200 });
}
