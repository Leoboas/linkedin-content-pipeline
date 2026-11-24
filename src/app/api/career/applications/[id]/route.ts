import { ApplicationPreparationStatus, JobApplicationEventType, JobApplicationStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateProfile } from "@/lib/career-engine";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";

const allowedStatuses = new Set<string>(Object.values(JobApplicationStatus));
const allowedPreparationStatuses = new Set<string>(Object.values(ApplicationPreparationStatus));
const approvalRequiredStages = new Set<ApplicationPreparationStatus>([
  ApplicationPreparationStatus.APPROVED_FOR_SUBMISSION,
  ApplicationPreparationStatus.SUBMITTING,
]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const profile = await getOrCreateProfile();
  const current = await prisma.jobApplication.findFirst({ where: { id, profileId: profile.id }, select: { id: true, jobId: true, authorizedResumeId: true, status: true, preparationStatus: true } });
  if (!current) return NextResponse.json({ error: "Candidatura não encontrada." }, { status: 404 });
  const data: { status?: JobApplicationStatus; preparationStatus?: ApplicationPreparationStatus; notes?: string | null; recruiterContact?: string | null; appliedAt?: Date | null; submissionEvidence?: string | null; submissionEvidenceAt?: Date | null } = {};
  if (typeof body.status === "string") {
    if (!allowedStatuses.has(body.status)) return NextResponse.json({ error: "Status de candidatura inválido." }, { status: 400 });
    data.status = body.status as JobApplicationStatus;
    if (["READY_FOR_REVIEW", "RESUME_PREPARED", "APPLIED"].includes(body.status) && !current.authorizedResumeId) {
      return NextResponse.json({ error: "Importe e selecione um dos quatro currículos autorizados antes de preparar ou registrar candidatura." }, { status: 409 });
    }
    if (body.status === "APPLIED") {
      const evidence = typeof body.submissionEvidence === "string" ? body.submissionEvidence.trim().slice(0, 1000) : "";
      if (evidence.length < 8) return NextResponse.json({ error: "Para registrar candidatura enviada, informe um comprovante ou confirmação do portal de destino." }, { status: 400 });
      data.appliedAt = new Date();
      data.submissionEvidence = evidence;
      data.submissionEvidenceAt = new Date();
    }
  }
  if (typeof body.preparationStatus === "string") {
    if (!allowedPreparationStatuses.has(body.preparationStatus)) return NextResponse.json({ error: "Etapa de preparação inválida." }, { status: 400 });
    if (approvalRequiredStages.has(body.preparationStatus as ApplicationPreparationStatus)) {
      const kit = await prisma.applicationKit.findFirst({ where: { applicationId: current.id }, orderBy: { version: "desc" }, select: { reviewStatus: true } });
      if (kit?.reviewStatus !== "APPROVED") return NextResponse.json({ error: "Aprove a versão atual do Application Kit antes de avançar." }, { status: 409 });
    }
    data.preparationStatus = body.preparationStatus as ApplicationPreparationStatus;
  }
  if (typeof body.notes === "string") data.notes = body.notes.slice(0, 5000).trim() || null;
  if (typeof body.recruiterContact === "string") data.recruiterContact = body.recruiterContact.slice(0, 2000).trim() || null;
  const application = await prisma.$transaction(async (tx) => {
    const updated = await tx.jobApplication.update({ where: { id }, data, include: { job: true } });
    if (data.status && data.status !== current.status) await tx.jobApplicationEvent.create({ data: {
      applicationId: id, eventType: JobApplicationEventType.RECRUITMENT_STATUS_CHANGED, fromRecruitmentStage: current.status, toRecruitmentStage: data.status,
      fromPreparationStage: current.preparationStatus, toPreparationStage: data.preparationStatus ?? current.preparationStatus, source: "USER",
      note: typeof body.eventNote === "string" ? body.eventNote.slice(0, 2000) : null,
    } });
    if (data.preparationStatus && data.preparationStatus !== current.preparationStatus) await tx.jobApplicationEvent.create({ data: {
      applicationId: id, eventType: JobApplicationEventType.PREPARATION_STATUS_CHANGED, fromRecruitmentStage: data.status ?? current.status, toRecruitmentStage: data.status ?? current.status,
      fromPreparationStage: current.preparationStatus, toPreparationStage: data.preparationStatus, source: "USER",
      note: typeof body.eventNote === "string" ? body.eventNote.slice(0, 2000) : null,
    } });
    if (data.recruiterContact !== undefined && data.recruiterContact !== null) await tx.jobApplicationEvent.create({ data: { applicationId: id, eventType: JobApplicationEventType.RECRUITER_CONTACT_RECORDED, source: "USER", note: data.recruiterContact } });
    if (data.notes !== undefined && data.notes !== null) await tx.jobApplicationEvent.create({ data: { applicationId: id, eventType: JobApplicationEventType.NOTE_ADDED, source: "USER", note: data.notes } });
    return updated;
  });
  return NextResponse.json({ application });
}
