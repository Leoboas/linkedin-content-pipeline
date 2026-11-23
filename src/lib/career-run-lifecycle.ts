import { SearchRunStatus, type PrismaClient } from "@prisma/client";

export const CAREER_QUEUED_TIMEOUT_MS = 10 * 60 * 1000;
export const CAREER_RUNNING_TIMEOUT_MS = 30 * 60 * 1000;

export function getCareerRunStaleCutoffs(now = new Date()) {
  return {
    queuedBefore: new Date(now.getTime() - CAREER_QUEUED_TIMEOUT_MS),
    runningBefore: new Date(now.getTime() - CAREER_RUNNING_TIMEOUT_MS),
  };
}

export function mayExecuteCareerRun(input: { status: string; eventId?: string | null; recordedEventId?: string | null }): boolean {
  return input.status === SearchRunStatus.QUEUED
    || (input.status === SearchRunStatus.RUNNING && Boolean(input.eventId && input.eventId === input.recordedEventId));
}

/**
 * Read-repair for orphaned queue rows. Conditional updates ensure that a worker
 * which starts concurrently is not changed from QUEUED/RUNNING to FAILED.
 */
export async function reconcileStaleCareerSearchRuns(
  delegate: PrismaClient["careerSearchRun"],
  now = new Date(),
): Promise<{ queuedExpired: number; runningExpired: number }> {
  const { queuedBefore, runningBefore } = getCareerRunStaleCutoffs(now);
  const [queued, running] = await Promise.all([
    delegate.updateMany({
      where: { status: SearchRunStatus.QUEUED, startedAt: { lt: queuedBefore } },
      data: {
        status: SearchRunStatus.FAILED,
        errorMessage: "Tempo limite excedido aguardando início no Inngest; execução encerrada automaticamente.",
        completedAt: now,
      },
    }),
    delegate.updateMany({
      where: { status: SearchRunStatus.RUNNING, executionStartedAt: { lt: runningBefore } },
      data: {
        status: SearchRunStatus.FAILED,
        errorMessage: "Tempo limite excedido durante a busca; execução encerrada automaticamente.",
        completedAt: now,
      },
    }),
  ]);
  return { queuedExpired: queued.count, runningExpired: running.count };
}
