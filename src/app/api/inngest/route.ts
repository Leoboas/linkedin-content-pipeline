import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { publishApprovedPost, reformulatePostWithFeedback, weeklyPostPipeline } from "@/inngest/functions/generateWeeklyPosts";
import { careerSearchPipeline } from "@/inngest/functions/careerEngine";

export const maxDuration = 300;

const handler = serve({
  client: inngest,
  functions: [weeklyPostPipeline, publishApprovedPost, reformulatePostWithFeedback, careerSearchPipeline],
});

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
