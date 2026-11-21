import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { prisma } from "@/lib/prisma";
import type { CareerSourceKey } from "@/lib/job-source-connectors";

const CAREER_SOURCE_KEYS = new Set<CareerSourceKey>(["CODERIO_LEVER", "HIMALAYAS", "REMOTIVE", "REMOTE_OK", "WE_WORK_REMOTELY"]);

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
    const bodyText = await request.text();
    let body: { acceptanceTest?: unknown } = {};
    if (bodyText.trim()) {
      try {
        const parsed: unknown = JSON.parse(bodyText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400 });
        body = parsed as typeof body;
      }
      catch { return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400 }); }
    }
    const acceptanceTest = body.acceptanceTest;
    let boundedOptions: { maxJobs: number; sourceKeys: CareerSourceKey[] } | undefined;
    if (acceptanceTest !== undefined) {
      if (!acceptanceTest || typeof acceptanceTest !== "object" || Array.isArray(acceptanceTest)) return NextResponse.json({ error: "Escopo de aceite inválido." }, { status: 400 });
      const maxJobs = (acceptanceTest as { maxJobs?: unknown }).maxJobs;
      const sourceKeys = (acceptanceTest as { sourceKeys?: unknown }).sourceKeys;
      if (typeof maxJobs !== "number" || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10 || !Array.isArray(sourceKeys) || sourceKeys.length !== 1 || typeof sourceKeys[0] !== "string" || !CAREER_SOURCE_KEYS.has(sourceKeys[0] as CareerSourceKey)) {
        return NextResponse.json({ error: "Escopo de aceite inválido; informe uma fonte e limite entre 1 e 10 vagas." }, { status: 400 });
      }
      boundedOptions = { maxJobs, sourceKeys: sourceKeys as CareerSourceKey[] };
    }
    const { run, shouldQueue } = await prisma.$transaction(async (tx) => {
      // O lock segue transacional e bloqueante; a projeção escalar evita que o Prisma
      // tente desserializar o retorno PostgreSQL `void` da função advisory lock.
      await tx.$queryRaw`SELECT 1::int AS acquired FROM pg_advisory_xact_lock(hashtext('career-search-enqueue'))`;
      const active = await tx.careerSearchRun.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { startedAt: "desc" } });
      if (active) return { run: active, shouldQueue: false };
      const queued = await tx.careerSearchRun.create({ data: { status: "QUEUED", parameters: { requestedFrom: "dashboard", ...(boundedOptions ? { acceptanceTest: true, maxJobs: boundedOptions.maxJobs, sourceKeys: boundedOptions.sourceKeys } : {}) } } });
      return { run: queued, shouldQueue: true };
    });
    if (!shouldQueue) return NextResponse.json({ accepted: true, alreadyRunning: true, run });
    createdRunId = run.id;
    const sent = await inngest.send({ name: "career/scan.requested", data: { triggeredAt: new Date().toISOString(), runId: run.id, ...(boundedOptions ? { maxJobs: boundedOptions.maxJobs, sourceKeys: boundedOptions.sourceKeys } : {}) } });
    console.info("[career/scan] busca enfileirada", { eventIds: sent.ids });
    return NextResponse.json({ accepted: true, queued: true, runId: run.id, run, event: "career/scan.requested" }, { status: 202 });
  } catch (error) {
    console.error("[career/scan] não foi possível enfileirar a busca", error);
    if (createdRunId) await prisma.careerSearchRun.update({ where: { id: createdRunId }, data: { status: "FAILED", errorMessage: "Não foi possível enfileirar a busca no Inngest.", completedAt: new Date() } });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao iniciar a busca de vagas." }, { status: 502 });
  }
}
