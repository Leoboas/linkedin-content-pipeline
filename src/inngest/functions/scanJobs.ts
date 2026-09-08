import { inngest } from "@/inngest/client";
import { linkedinSearchQueries } from "@/lib/career-engine";
import { sendCareerSearchLinks } from "@/lib/telegram";

export const dailyCareerSearchLinks = inngest.createFunction(
  { id: "send-daily-career-search-links", retries: 2 },
  { event: "career/search-links.requested" },
  async ({ step }) => {
    const queries = linkedinSearchQueries();
    await step.run("send-career-search-links", () => sendCareerSearchLinks(queries));
    return { sent: true, queries: queries.length };
  },
);
