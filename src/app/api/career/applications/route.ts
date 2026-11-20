import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateProfile } from "@/lib/career-engine";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const profile = await getOrCreateProfile();
  const applications = await prisma.jobApplication.findMany({
    where: { profileId: profile.id },
    include: { job: { include: { matches: { where: { profileId: profile.id }, take: 1 } } }, resumeDraft: { select: { id: true, targetRole: true, atsScore: true, status: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ applications: applications.map(({ job, ...application }) => {
    const latestMatch = job.matches[0];
    const { matches: _matches, ...jobData } = job;
    return { ...application, job: { ...jobData, score: latestMatch?.score ?? 0, label: latestMatch?.label ?? "Sem match", rationale: latestMatch?.rationale ?? "" } };
  }) });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  if (typeof body.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.jobId)) return NextResponse.json({ error: "jobId inválido." }, { status: 400 });
  const profile = await getOrCreateProfile();
  const job = await prisma.jobListing.findUnique({ where: { id: body.jobId }, select: { id: true } });
  if (!job) return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 });
  const application = await prisma.jobApplication.upsert({
    where: { profileId_jobId: { profileId: profile.id, jobId: job.id } },
    create: { profileId: profile.id, jobId: job.id, status: "SAVED" },
    update: {},
    include: { job: true },
  });
  return NextResponse.json({ application }, { status: 201 });
}
