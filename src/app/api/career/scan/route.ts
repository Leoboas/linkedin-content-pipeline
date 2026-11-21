import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const runId = new URL(request.url).searchParams.get("runId");
  const select = { id: true, status: true, queryCount: true, resultCount: true, savedCount: true, discardedCount: true, errorCount: true, sourceResults: true, errorMessage: true, startedAt: true, executionStartedAt: true, completedAt: true } as const;
  const run = runId
    ? await prisma.careerSearchRun.findUnique({ where: { id: runId }, select })
    : await prisma.careerSearchRun.findFirst({ orderBy: { startedAt: "desc" }, select });
  if (runId && !run) return NextResponse.json({ error: "Execução de busca não encontrada." }, { status: 404 });
  return NextResponse.json({ run });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Configure o DASHBOARD_ADMIN_TOKEN." }, { status: 401 });
  let createdRunId: string | null = null;
  try {
    const { run, shouldQueue } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('career-search-enqueue'))`;
      const active = await tx.careerSearchRun.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { startedAt: "desc" } });
      if (active) return { run: active, shouldQueue: false };
      const queued = await tx.careerSearchRun.create({ data: { status: "QUEUED", parameters: { requestedFrom: "dashboard" } } });
      return { run: queued, shouldQueue: true };
    });
    if (!shouldQueue) return NextResponse.json({ accepted: true, alreadyRunning: true, run });
    createdRunId = run.id;
    const sent = await inngest.send({ name: "career/scan.requested", data: { triggeredAt: new Date().toISOString(), runId: run.id } });
    console.info("[career/scan] busca enfileirada", { eventIds: sent.ids });
    return NextResponse.json({ accepted: true, queued: true, runId: run.id, run, event: "career/scan.requested" }, { status: 202 });
  } catch (error) {
    console.error("[career/scan] não foi possível enfileirar a busca", error);
    if (createdRunId) await prisma.careerSearchRun.update({ where: { id: createdRunId }, data: { status: "FAILED", errorMessage: "Não foi possível enfileirar a busca no Inngest.", completedAt: new Date() } });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao iniciar a busca de vagas." }, { status: 502 });
  }
}
