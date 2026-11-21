import { inngest } from "@/inngest/client";
import { runCareerScan } from "@/lib/career-engine";
import type { CareerSourceKey } from "@/lib/job-source-connectors";

export const careerSearchPipeline = inngest.createFunction(
  { id: "career-daily-job-hunter", retries: 2 },
  { event: "career/scan.requested" },
  async ({ event, step }) => {
    const data = event.data as { runId?: string; maxJobs?: number; sourceKeys?: CareerSourceKey[] };
    try {
      const result = await step.run("search-match-and-audit", () => runCareerScan(data.runId, data.maxJobs && data.sourceKeys?.length ? { maxJobs: data.maxJobs, sourceKeys: data.sourceKeys } : undefined));
      console.info("[career/inngest] execução concluída", { runId: result.runId, discovered: result.discovered, matches: result.matches.length, sourceRequests: result.queries });
      return { runId: result.runId, discovered: result.discovered, matches: result.matches.length };
    } catch (error) {
      console.error("[career/inngest] execução falhou", { runId: data.runId, error: error instanceof Error ? error.message : "Erro desconhecido" });
      throw error;
    }
  },
);
