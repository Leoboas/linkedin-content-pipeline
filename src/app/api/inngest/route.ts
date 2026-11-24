import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { publishApprovedPost, reformulatePostWithFeedback, weeklyPostPipeline } from "@/inngest/functions/generateWeeklyPosts";
import { careerSearchPipeline, prepareCareerApplicationKit, recoverCareerSubmissionOutbox, submitCareerApplication } from "@/inngest/functions/careerEngine";
import { dailyCareerSearchLinks } from "@/inngest/functions/scanJobs";

export const maxDuration = 300;

const handler = serve({
  client: inngest,
  functions: [weeklyPostPipeline, publishApprovedPost, reformulatePostWithFeedback, careerSearchPipeline, prepareCareerApplicationKit, dailyCareerSearchLinks, submitCareerApplication, recoverCareerSubmissionOutbox],
});

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
