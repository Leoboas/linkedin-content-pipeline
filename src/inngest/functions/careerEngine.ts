import { inngest } from "@/inngest/client";
import { runCareerScan } from "@/lib/career-engine";
import { prepareApplicationKit } from "@/lib/career-application-kit";
import type { CareerSourceKey } from "@/lib/job-source-connectors";

export const careerSearchPipeline = inngest.createFunction(
  { id: "career-daily-job-hunter", retries: 2 },
  { event: "career/scan.requested" },
  async ({ event, step }) => {
    const data = event.data as { runId?: string; maxJobs?: number; sourceKeys?: CareerSourceKey[] };
    try {
      const result = await step.run("search-match-and-audit", () => runCareerScan(data.runId, data.maxJobs && data.sourceKeys?.length ? { maxJobs: data.maxJobs, sourceKeys: data.sourceKeys } : undefined, event.id));
      console.info("[career/inngest] execução concluída", { runId: result.runId, discovered: result.discovered, matches: result.matches.length, sourceRequests: result.queries });
      return { runId: result.runId, discovered: result.discovered, matches: result.matches.length };
    } catch (error) {
      console.error("[career/inngest] execução falhou", { runId: data.runId, error: error instanceof Error ? error.message : "Erro desconhecido" });
      throw error;
    }
  },
);

export const prepareCareerApplicationKit = inngest.createFunction(
  {
    id: "career-prepare-application-kit",
    retries: 2,
    idempotency: "event.data.requestKey",
    concurrency: { limit: 1, key: "event.data.applicationId" },
  },
  { event: "career/application.prepare.requested" },
  async ({ event, step }) => {
    const data = event.data as { applicationId: string; requestKey: string };
    if (!data.applicationId || !data.requestKey) throw new Error("Evento de preparação de candidatura sem chave idempotente.");
    return step.run("prepare-versioned-application-kit", () => prepareApplicationKit(data.applicationId, data.requestKey));
  },
);
