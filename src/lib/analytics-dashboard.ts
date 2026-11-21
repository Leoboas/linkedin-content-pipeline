import { PostStatus } from "@prisma/client";
import { buildPerformanceComparisonGroups, type PerformanceSnapshot } from "@/lib/analytics-insights-core";
import { linkedInOfficialAnalyticsProvider } from "@/lib/analytics-providers";
import { prisma } from "@/lib/prisma";

const WINDOWS = ["24H", "72H", "7D", "LIFETIME"] as const;
export type AnalyticsWindow = typeof WINDOWS[number] | "BEST_AVAILABLE";

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Number((sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2).toFixed(2));
}

function sum(values: Array<number | null>): { value: number | null; measuredPosts: number } {
  const present = values.filter((value): value is number => value !== null);
  return { value: present.length ? present.reduce((total, value) => total + value, 0) : null, measuredPosts: present.length };
}

function preferredSnapshots<T extends { measurementWindow: string; capturedAt: Date }>(rows: T[], window: AnalyticsWindow): T[] {
  const latestByWindow = latestSnapshotPerWindow(rows);
  if (window !== "BEST_AVAILABLE") return latestByWindow.filter((row) => row.measurementWindow === window);
  const priority = ["7D", "72H", "24H", "LIFETIME"];
  const chosen = priority.map((candidate) => latestByWindow.find((row) => row.measurementWindow === candidate)).find(Boolean);
  return chosen ? [chosen] : [];
}

function latestSnapshotPerWindow<T extends { measurementWindow: string; capturedAt: Date }>(rows: T[]): T[] {
  const latestByWindow = new Map<string, T>();
  for (const row of [...rows].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())) {
    if (!latestByWindow.has(row.measurementWindow)) latestByWindow.set(row.measurementWindow, row);
  }
  return [...latestByWindow.values()];
}

function parseBreakdown(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export async function getAnalyticsDashboard(input: { from: Date; to: Date; window: AnalyticsWindow }) {
  const [posts, importBatches] = await Promise.all([prisma.post.findMany({
    where: { status: PostStatus.PUBLISHED, publishedAt: { gte: input.from, lte: input.to } },
    orderBy: { publishedAt: "desc" },
    take: 1_000,
    select: {
      id: true, title: true, language: true, formatType: true, editorialPillar: true,
      editorialObjective: true, topic: true, publishedAt: true, linkedinPostId: true,
      qualityReview: true, creativeBriefs: { orderBy: { createdAt: "desc" }, take: 1, select: { visualBrief: true, evidenceSnapshot: true } },
      metrics: {
        where: { source: { in: ["LINKEDIN_API", "MANUAL", "CSV_IMPORT", "XLSX_IMPORT"] } },
        orderBy: { capturedAt: "desc" },
      },
    },
  }), prisma.analyticsImportBatch.findMany({
    where: { capturedAt: { gte: input.from, lte: input.to } },
    orderBy: { capturedAt: "desc" }, take: 20,
    select: { id: true, fileName: true, sourceLabel: true, status: true, rowsSeen: true, rowsImported: true, rowsUnmatched: true, errors: true, aggregateRows: true, capturedAt: true },
  })]);
  const snapshots = posts.flatMap((post) => preferredSnapshots(post.metrics, input.window).map((metric) => ({
    post,
    metric,
  })));
  const values = <K extends keyof (typeof snapshots)[number]["metric"]>(key: K) => snapshots.map(({ metric }) => metric[key] as number | null);
  const impressions = values("impressions");
  const reached = values("membersReached");
  const views = values("profileViewsFromContent");
  const followers = values("followersGained");
  const outAbsolute = values("impressionsOutOfNetwork");
  const inAbsolute = values("impressionsInNetwork");
  const reportedPercent = snapshots.map(({ metric }) => metric.outOfNetworkPercent).filter((value): value is number => value !== null);
  const pairedNetworkMetrics = snapshots.filter(({ metric }) => metric.impressionsOutOfNetwork !== null && metric.impressionsInNetwork !== null);
  const outOfNetworkTotal = pairedNetworkMetrics.reduce((total, { metric }) => total + metric.impressionsOutOfNetwork!, 0);
  const inNetworkTotal = pairedNetworkMetrics.reduce((total, { metric }) => total + metric.impressionsInNetwork!, 0);
  const inferredFromAbsolute = pairedNetworkMetrics.length && outOfNetworkTotal + inNetworkTotal > 0
    ? Number((outOfNetworkTotal / (outOfNetworkTotal + inNetworkTotal) * 100).toFixed(2))
    : null;
  const quality = posts.map((post) => {
    const review = post.qualityReview && typeof post.qualityReview === "object" && !Array.isArray(post.qualityReview) ? post.qualityReview as Record<string, unknown> : {};
    const intelligence = review.editorialIntelligence && typeof review.editorialIntelligence === "object" ? review.editorialIntelligence as Record<string, unknown> : {};
    const career = intelligence.careerRelevance as Record<string, unknown> | undefined;
    const hook = intelligence.hookQuality as Record<string, unknown> | undefined;
    return { careerRelevanceScore: typeof career?.score === "number" ? career.score : null, hookQualityScore: typeof hook?.score === "number" ? hook.score : null };
  });
  const qualified: Record<string, Map<string, number>> = { audienceCountry: new Map(), audienceRole: new Map(), audienceSeniority: new Map(), audienceIndustry: new Map() };
  for (const { metric } of snapshots) {
    const breakdown = parseBreakdown(metric.audienceBreakdown);
    if (!breakdown) continue;
    for (const dimension of Object.keys(qualified)) {
      const label = breakdown[dimension];
      if (label) qualified[dimension]!.set(label, (qualified[dimension]!.get(label) ?? 0) + 1);
    }
  }
  const audience = Object.fromEntries(Object.entries(qualified).map(([dimension, rows]) => [dimension, {
    status: rows.size ? "AVAILABLE" : "INSUFFICIENT_DATA",
    sampleSize: [...rows.values()].reduce((total, count) => total + count, 0),
    distribution: [...rows.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    note: "Somente categorias importadas explicitamente; não inferimos cargo, país ou senioridade de pessoas individuais.",
  }]));
  const performanceRows = snapshots.map(({ post, metric }) => ({
    postId: post.id,
    measurementWindow: metric.measurementWindow,
    exposureHours: metric.exposureHours,
    impressions: metric.impressions,
    membersReached: metric.membersReached,
    reactions: metric.reactions,
    comments: metric.comments,
    shares: metric.shares,
    postSaves: metric.postSaves,
    postSends: metric.postSends,
    linkClicks: metric.linkClicks,
    profileViewsFromContent: metric.profileViewsFromContent,
    engagementScore: metric.interactionRate,
    capturedAt: metric.capturedAt,
    source: metric.source,
    post: {
      id: post.id, title: post.title, editorialPillar: post.editorialPillar, formatType: post.formatType,
      visualFormat: post.creativeBriefs[0]?.visualBrief && typeof post.creativeBriefs[0].visualBrief === "object" && !Array.isArray(post.creativeBriefs[0].visualBrief)
        ? String((post.creativeBriefs[0].visualBrief as Record<string, unknown>).format ?? "") || null : null,
      editorialObjective: post.editorialObjective, language: post.language, topic: post.topic, publishedAt: post.publishedAt,
      qualityScore: quality[posts.findIndex((candidate) => candidate.id === post.id)]?.careerRelevanceScore ?? null, qualityStatus: null,
    },
  } satisfies PerformanceSnapshot));
  const comparisons = buildPerformanceComparisonGroups(performanceRows);
  const hasAudience = Object.values(audience).some((item) => item.status === "AVAILABLE");
  const providerReadiness = linkedInOfficialAnalyticsProvider.readiness("post");
  const automaticCollection = process.env.LINKEDIN_ANALYTICS_CRON_ENABLED !== "true"
    ? { status: "DISABLED", reason: "cron-flag-disabled" }
    : process.env.LINKEDIN_API_BUDGET_ENABLED !== "true"
      ? { status: "DISABLED", reason: "shared-api-budget-disabled" }
      : !providerReadiness.enabled
        ? { status: "UNAVAILABLE", reason: providerReadiness.reason ?? "provider-not-ready" }
        : { status: "ACTIVE", reason: null };
  const ranking = (key: "impressions" | "membersReached" | "impressionsOutOfNetwork" | "profileViewsFromContent") => snapshots
    .filter(({ metric }) => typeof metric[key] === "number")
    .sort((a, b) => (b.metric[key] as number) - (a.metric[key] as number))
    .slice(0, 10)
    .map(({ post, metric }) => ({ postId: post.id, title: post.title, language: post.language, publishedAt: post.publishedAt, value: metric[key] as number, window: metric.measurementWindow, exposureHours: metric.exposureHours, source: metric.source, capturedAt: metric.capturedAt }));
  const postRows = posts.map((post) => {
    const availableSnapshots = latestSnapshotPerWindow(post.metrics);
    const selectedMetric = preferredSnapshots(post.metrics, input.window)[0] ?? null;
    const review = post.qualityReview && typeof post.qualityReview === "object" && !Array.isArray(post.qualityReview) ? post.qualityReview as Record<string, unknown> : {};
    const intel = review.editorialIntelligence && typeof review.editorialIntelligence === "object" ? review.editorialIntelligence as Record<string, unknown> : {};
    const creative = post.creativeBriefs[0];
    const visual = creative?.visualBrief && typeof creative.visualBrief === "object" && !Array.isArray(creative.visualBrief) ? creative.visualBrief as Record<string, unknown> : {};
    return {
      id: post.id, title: post.title, language: post.language, publishedAt: post.publishedAt,
      formatType: post.formatType, visualFormat: typeof visual.format === "string" ? visual.format : null,
      pillar: post.editorialPillar, objective: post.editorialObjective, topic: post.topic,
      careerRelevanceScore: typeof intel.careerRelevanceScore === "number" ? intel.careerRelevanceScore : null,
      hookQualityScore: typeof intel.hookQualityScore === "number" ? intel.hookQualityScore : null,
      evidence: creative?.evidenceSnapshot ?? null,
      snapshot: selectedMetric ? {
        window: selectedMetric.measurementWindow, capturedAt: selectedMetric.capturedAt, exposureHours: selectedMetric.exposureHours, latenessHours: selectedMetric.latenessHours,
        source: selectedMetric.source, availability: selectedMetric.availability,
        impressions: selectedMetric.impressions, membersReached: selectedMetric.membersReached,
        inNetworkPercent: selectedMetric.inNetworkPercent, outOfNetworkPercent: selectedMetric.outOfNetworkPercent,
        impressionsInNetwork: selectedMetric.impressionsInNetwork, impressionsOutOfNetwork: selectedMetric.impressionsOutOfNetwork,
        reactions: selectedMetric.reactions, comments: selectedMetric.comments, reposts: selectedMetric.shares,
        saves: selectedMetric.postSaves, sends: selectedMetric.postSends, linkClicks: selectedMetric.linkClicks,
        profileViewsFromPost: selectedMetric.profileViewsFromContent, followersGained: selectedMetric.followersGained,
        audienceBreakdown: selectedMetric.audienceBreakdown,
      } : null,
      snapshots: availableSnapshots.map((metric) => ({
        window: metric.measurementWindow, capturedAt: metric.capturedAt, exposureHours: metric.exposureHours, latenessHours: metric.latenessHours,
        source: metric.source, availability: metric.availability, impressions: metric.impressions,
        membersReached: metric.membersReached, outOfNetworkPercent: metric.outOfNetworkPercent,
      })),
    };
  });
  const windowEvolution = (["24H", "72H", "7D"] as const).map((window) => {
    const windowRows = posts.flatMap((post) => latestSnapshotPerWindow(post.metrics).filter((metric) => metric.measurementWindow === window));
    return {
      window,
      sampleSize: windowRows.length,
      medianImpressions: median(windowRows.map((metric) => metric.impressions).filter((value): value is number => value !== null)),
      medianMembersReached: median(windowRows.map((metric) => metric.membersReached).filter((value): value is number => value !== null)),
      medianExposureHours: median(windowRows.map((metric) => metric.exposureHours).filter((value): value is number => value !== null)),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    automaticCollection,
    period: { from: input.from.toISOString(), to: input.to.toISOString(), window: input.window },
    overview: {
      publishedPosts: posts.length,
      postsWithSnapshot: snapshots.length,
      impressions: sum(impressions),
      averageImpressionsPerPost: impressions.filter((value): value is number => value !== null).length ? Number((impressions.filter((value): value is number => value !== null).reduce((a, b) => a + b, 0) / impressions.filter((value): value is number => value !== null).length).toFixed(1)) : null,
      medianImpressionsPerPost: median(impressions.filter((value): value is number => value !== null)),
      membersReached: { total: null, meanPerPost: median(reached.filter((value): value is number => value !== null)) === null ? null : Number((reached.filter((value): value is number => value !== null).reduce((a, b) => a + b, 0) / reached.filter((value): value is number => value !== null).length).toFixed(1)), medianPerPost: median(reached.filter((value): value is number => value !== null)), measuredPosts: reached.filter((value) => value !== null).length, note: "Pessoas alcançadas não são somadas entre publicações, pois podem se repetir." },
      reactions: sum(values("reactions")), comments: sum(values("comments")), reposts: sum(values("shares")), saves: sum(values("postSaves")), sends: sum(values("postSends")), linkClicks: sum(values("linkClicks")), profileViewsFromPosts: sum(views), followersGainedFromPosts: sum(followers),
      outOfNetworkPercent: inferredFromAbsolute ?? (reportedPercent.length ? median(reportedPercent) : null),
      outOfNetworkPercentMethod: inferredFromAbsolute !== null ? "weighted from explicitly measured network impression counts" : reportedPercent.length ? "median of explicitly reported post percentages" : "INSUFFICIENT_DATA",
      outOfNetworkImpressions: sum(outAbsolute),
      averageCareerRelevanceScore: quality.filter((item) => item.careerRelevanceScore !== null).length ? Number((quality.reduce((a, item) => a + (item.careerRelevanceScore ?? 0), 0) / quality.filter((item) => item.careerRelevanceScore !== null).length).toFixed(2)) : null,
      averageHookQualityScore: quality.filter((item) => item.hookQualityScore !== null).length ? Number((quality.reduce((a, item) => a + (item.hookQualityScore ?? 0), 0) / quality.filter((item) => item.hookQualityScore !== null).length).toFixed(1)) : null,
    },
    audience: hasAudience ? audience : Object.fromEntries(Object.entries(audience).map(([key, value]) => [key, { ...value, status: "INSUFFICIENT_DATA" }])),
    rankings: { impressions: ranking("impressions"), membersReached: ranking("membersReached"), outOfNetworkImpressions: ranking("impressionsOutOfNetwork"), profileViewsFromPost: ranking("profileViewsFromContent") },
    comparisons,
    windowEvolution,
    posts: postRows,
    aggregateImports: importBatches.map((batch) => ({ ...batch, aggregateRows: batch.aggregateRows, errors: batch.errors })),
    limitations: ["As métricas são observações por publicação; impressões de várias publicações não representam pessoas únicas.", "Métricas ausentes permanecem NULL e não são tratadas como zero.", "Comparações são descritivas, não provam causalidade.", "A audiência só aparece quando importada explicitamente pelo usuário ou retornada por fonte autorizada."],
  };
}
