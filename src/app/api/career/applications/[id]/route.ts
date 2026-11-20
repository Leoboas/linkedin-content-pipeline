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
  const current = await prisma.jobApplication.findFirst({ where: { id, profileId: profile.id }, select: { id: true } });
  if (!current) return NextResponse.json({ error: "Candidatura não encontrada." }, { status: 404 });
  const data: { status?: JobApplicationStatus; notes?: string | null; appliedAt?: Date | null } = {};
  if (typeof body.status === "string") {
    if (!allowedStatuses.has(body.status)) return NextResponse.json({ error: "Status de candidatura inválido." }, { status: 400 });
    data.status = body.status as JobApplicationStatus;
    if (body.status === "APPLIED") data.appliedAt = new Date();
  }
  if (typeof body.notes === "string") data.notes = body.notes.slice(0, 5000).trim() || null;
  const application = await prisma.jobApplication.update({ where: { id }, data, include: { job: true } });
  return NextResponse.json({ application });
}
