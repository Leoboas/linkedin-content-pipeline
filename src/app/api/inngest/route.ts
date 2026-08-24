import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { publishApprovedPost, reformulatePostWithFeedback, weeklyPostPipeline } from "@/inngest/functions/generateWeeklyPosts";

const handler = serve({
  client: inngest,
  functions: [weeklyPostPipeline, publishApprovedPost, reformulatePostWithFeedback],
});

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
