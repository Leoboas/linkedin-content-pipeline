import { inngest } from "@/inngest/client";
import { runCareerScan } from "@/lib/career-engine";

export const careerSearchPipeline = inngest.createFunction(
  { id: "career-daily-job-hunter", retries: 2 },
  { event: "career/scan.requested" },
  async ({ event, step }) => {
    const data = event.data as { runId?: string };
    try {
      const result = await step.run("search-match-and-audit", () => runCareerScan(data.runId));
      console.info("[career/inngest] execução concluída", { runId: result.runId, discovered: result.discovered, matches: result.matches.length, sourceRequests: result.queries });
      return { runId: result.runId, discovered: result.discovered, matches: result.matches.length };
    } catch (error) {
      console.error("[career/inngest] execução falhou", { runId: data.runId, error: error instanceof Error ? error.message : "Erro desconhecido" });
      throw error;
    }
  },
);
