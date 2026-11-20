import { PostStatus, Prisma } from "@prisma/client";
import { fetchLinkedInMemberFollowerCount, fetchLinkedInMemberPostMetrics } from "@/lib/linkedin";
import { metricAvailability, nextDueMeasurementWindow, POST_METRIC_FIELDS, snapshotIdempotencyKey, observedInteractionRate } from "@/lib/analytics-data";
import { classifyLinkedInFailure, getAvailableLinkedInApiCalls, LinkedInApiBudgetExceeded } from "@/lib/linkedin-api-budget";
import { prisma } from "@/lib/prisma";

function maxPostsPerRun(): number {
  const value = Number(process.env.LINKEDIN_ANALYTICS_MAX_POSTS_PER_RUN ?? "5");
  if (!Number.isSafeInteger(value) || value < 1 || value > 25) return 5;
  return value;
}

export interface AnalyticsSyncResult {
  enabled: boolean;
  synced: number;
  partial: number;
  skipped: number;
  callsPerPostEstimate?: number;
  budgetRemaining?: number;
  reason?: string;
}

export async function syncLinkedInPostMetrics(now = new Date()): Promise<AnalyticsSyncResult> {
  if (process.env.LINKEDIN_ANALYTICS_CRON_ENABLED !== "true") {
    return { enabled: false, synced: 0, partial: 0, skipped: 0, reason: "cron-disabled-until-validated" };
  }
  if (process.env.LINKEDIN_API_BUDGET_ENABLED !== "true") {
    return { enabled: false, synced: 0, partial: 0, skipped: 0, reason: "shared-api-budget-not-enabled" };
  }
  if (process.env.LINKEDIN_POST_ANALYTICS_ENABLED !== "true") {
    return { enabled: false, synced: 0, partial: 0, skipped: 0, reason: "disabled-by-flag" };
  }
  if (!process.env.LINKEDIN_ACCESS_TOKEN) {
    return { enabled: true, synced: 0, partial: 0, skipped: 0, reason: "missing-access-token" };
  }

  const callsPerPostEstimate = Object.keys(POST_METRIC_FIELDS).length;
  let budgetRemaining: number;
  try { budgetRemaining = (await getAvailableLinkedInApiCalls(now)) ?? 0; }
  catch { return { enabled: true, synced: 0, partial: 0, skipped: 0, callsPerPostEstimate, reason: "budget-ledger-unavailable" }; }
  const budgetedPostLimit = Math.floor(budgetRemaining / callsPerPostEstimate);
  if (budgetedPostLimit < 1) return { enabled: true, synced: 0, partial: 0, skipped: 0, callsPerPostEstimate, budgetRemaining, reason: "insufficient-budget-for-one-post" };

  const posts = await prisma.post.findMany({
    where: { status: PostStatus.PUBLISHED, linkedinPostId: { not: null }, publishedAt: { not: null } },
    select: {
      id: true,
      linkedinPostId: true,
      publishedAt: true,
      metrics: { where: { source: "LINKEDIN_API" }, select: { measurementWindow: true, availability: true } },
    },
    orderBy: { publishedAt: "asc" },
    take: 500,
  });

  const due = posts.flatMap((post) => {
    if (!post.linkedinPostId || !post.publishedAt) return [];
    const ageHours = (now.getTime() - post.publishedAt.getTime()) / 3_600_000;
    // A successful response with absent metrics is still a valid observation:
    // preserve NULLs and don't spend quota re-querying stable unsupported metrics.
    // HTTP failures create no snapshot and therefore remain retryable.
    const captured = new Set(post.metrics
      .filter((metric) => ["AVAILABLE", "PARTIAL", "UNAVAILABLE"].includes(metric.availability))
      .map((metric) => metric.measurementWindow));
    const window = nextDueMeasurementWindow(ageHours, captured);
    return window ? [{ ...post, window, capturedWindowCount: captured.size, ageHours }] : [];
  }).sort((a, b) => a.capturedWindowCount - b.capturedWindowCount || b.ageHours - a.ageHours)
    .slice(0, Math.min(maxPostsPerRun(), budgetedPostLimit));

  let synced = 0;
  let partial = 0;
  let skipped = posts.length - due.length;
  let stopReason: string | undefined;
  for (const post of due) {
    try {
      const metrics = await fetchLinkedInMemberPostMetrics(post.linkedinPostId!);
      const values: Record<string, number | null> = {};
      for (const metric of metrics) {
        const field = POST_METRIC_FIELDS[metric.metricType.toUpperCase() as keyof typeof POST_METRIC_FIELDS];
        if (field) values[field] = metric.count;
      }
      const completeness = metricAvailability(values);
      const interactions = observedInteractionRate({
        impressions: values.impressions ?? null,
        reactions: values.reactions ?? null,
        comments: values.comments ?? null,
        shares: values.shares ?? null,
      });
      const data = {
        ...values,
        postId: post.id,
        linkedinPostId: post.linkedinPostId,
        publishedAtSnapshot: post.publishedAt,
        source: "LINKEDIN_API",
        apiVersion: process.env.LINKEDIN_VERSION ?? "202606",
        measurementWindow: post.window,
        availability: completeness,
        interactionRate: interactions,
        exposureHours: Number(((now.getTime() - post.publishedAt!.getTime()) / 3_600_000).toFixed(2)),
        capturedAt: now,
        idempotencyKey: snapshotIdempotencyKey(post.id, "LINKEDIN_API", post.window, now),
      } satisfies Prisma.PostMetricUncheckedCreateInput;

      await prisma.postMetric.upsert({
        where: { idempotencyKey: data.idempotencyKey },
        create: data,
        update: {
          ...values,
          availability: completeness,
          interactionRate: interactions,
          capturedAt: now,
        },
      });
      if (completeness === "UNAVAILABLE") partial += 1;
      else if (completeness === "PARTIAL") partial += 1;
      else synced += 1;
    } catch (error) {
      skipped += 1;
      const category = error instanceof LinkedInApiBudgetExceeded ? "daily-budget" : classifyLinkedInFailure(error);
      console.warn("[linkedin-analytics] snapshot not collected", {
        postId: post.id,
        measurementWindow: post.window,
        category,
      });
      if (["unauthorized", "forbidden", "rate_limited", "daily-budget"].includes(category)) {
        stopReason = category;
        skipped += due.length - due.indexOf(post) - 1;
        break;
      }
    }
  }
  return { enabled: true, synced, partial, skipped, callsPerPostEstimate, budgetRemaining, reason: stopReason };
}

export async function syncLinkedInProfileMetrics(now = new Date()): Promise<{ enabled: boolean; synced: number; reason?: string }> {
  if (process.env.LINKEDIN_ANALYTICS_CRON_ENABLED !== "true") return { enabled: false, synced: 0, reason: "cron-disabled-until-validated" };
  if (process.env.LINKEDIN_API_BUDGET_ENABLED !== "true") return { enabled: false, synced: 0, reason: "shared-api-budget-not-enabled" };
  if (process.env.LINKEDIN_PROFILE_ANALYTICS_ENABLED !== "true") return { enabled: false, synced: 0, reason: "disabled-by-flag" };
  if (!process.env.LINKEDIN_ACCESS_TOKEN) return { enabled: true, synced: 0, reason: "missing-access-token" };
  try {
    const value = await fetchLinkedInMemberFollowerCount();
    if (value === null) return { enabled: true, synced: 0, reason: "metric-unavailable" };
    const key = snapshotIdempotencyKey("profile:FOLLOWERS", "LINKEDIN_API", "LIFETIME", now);
    await prisma.profileMetric.upsert({
      where: { idempotencyKey: key },
      create: { metricType: "FOLLOWERS", value, source: "LINKEDIN_API", apiVersion: process.env.LINKEDIN_VERSION ?? "202606", availability: "AVAILABLE", capturedAt: now, idempotencyKey: key },
      update: { value, availability: "AVAILABLE", capturedAt: now },
    });
    return { enabled: true, synced: 1 };
  } catch (error) {
    console.warn("[linkedin-analytics] profile metric not collected", { metricType: "FOLLOWERS", error: error instanceof Error ? error.message : String(error) });
    return { enabled: true, synced: 0, reason: "api-error" };
  }
}
