import { JobApplicationStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateProfile } from "@/lib/career-engine";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";

const allowedStatuses = new Set<string>(Object.values(JobApplicationStatus));

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const profile = await getOrCreateProfile();
  const current = await prisma.jobApplication.findFirst({ where: { id, profileId: profile.id }, select: { id: true, jobId: true, authorizedResumeId: true } });
  if (!current) return NextResponse.json({ error: "Candidatura não encontrada." }, { status: 404 });
  const data: { status?: JobApplicationStatus; notes?: string | null; appliedAt?: Date | null; submissionEvidence?: string | null; submissionEvidenceAt?: Date | null } = {};
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
  if (typeof body.notes === "string") data.notes = body.notes.slice(0, 5000).trim() || null;
  const application = await prisma.jobApplication.update({ where: { id }, data, include: { job: true } });
  return NextResponse.json({ application });
}
