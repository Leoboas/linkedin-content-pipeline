import { inngest } from "@/inngest/client";
import { runCareerScan } from "@/lib/career-engine";
import { sendCareerDigest } from "@/lib/telegram";

export const careerSearchPipeline = inngest.createFunction(
  { id: "career-daily-job-hunter", retries: 2 },
  { event: "career/scan.requested" },
  async ({ step }) => {
    const result = await step.run("search-match-and-audit", () => runCareerScan());
    await step.run("notify-career-matches", () => sendCareerDigest(result));
    return { runId: result.runId, discovered: result.discovered, matches: result.matches.length };
  },
);
