import assert from "node:assert/strict";
import { SearchRunStatus, type PrismaClient } from "@prisma/client";
import { CAREER_QUEUED_TIMEOUT_MS, CAREER_RUNNING_TIMEOUT_MS, getCareerRunStaleCutoffs, mayExecuteCareerRun, reconcileStaleCareerSearchRuns } from "../src/lib/career-run-lifecycle";

async function main(): Promise<void> {
  const now = new Date("2026-11-23T16:00:00.000Z");
  const cutoffs = getCareerRunStaleCutoffs(now);
  assert.equal(now.getTime() - cutoffs.queuedBefore.getTime(), CAREER_QUEUED_TIMEOUT_MS);
  assert.equal(now.getTime() - cutoffs.runningBefore.getTime(), CAREER_RUNNING_TIMEOUT_MS);
  assert.equal(mayExecuteCareerRun({ status: SearchRunStatus.QUEUED }), true);
  assert.equal(mayExecuteCareerRun({ status: SearchRunStatus.RUNNING, eventId: "event-1", recordedEventId: "event-1" }), true);
  assert.equal(mayExecuteCareerRun({ status: SearchRunStatus.RUNNING, eventId: "event-2", recordedEventId: "event-1" }), false);
  assert.equal(mayExecuteCareerRun({ status: SearchRunStatus.FAILED, eventId: "event-1", recordedEventId: "event-1" }), false);

  const calls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const delegate = {
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      calls.push(args);
      return { count: 1 };
    },
  } as unknown as PrismaClient["careerSearchRun"];
  const result = await reconcileStaleCareerSearchRuns(delegate, now);

  assert.deepEqual(result, { queuedExpired: 1, runningExpired: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].where, { status: SearchRunStatus.QUEUED, startedAt: { lt: cutoffs.queuedBefore } });
  assert.deepEqual(calls[1].where, { status: SearchRunStatus.RUNNING, executionStartedAt: { lt: cutoffs.runningBefore } });
  assert.equal(calls[0].data.status, SearchRunStatus.FAILED);
  assert.equal(calls[1].data.status, SearchRunStatus.FAILED);
  assert.equal(calls[0].data.completedAt, now);
  assert.equal(calls[1].data.completedAt, now);

  console.log("Career run lifecycle: timeouts and guarded stale-run reconciliation passed.");
}

void main();
