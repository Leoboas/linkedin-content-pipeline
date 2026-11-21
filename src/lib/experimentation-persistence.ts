import { createHash } from "node:crypto";
import { EditorialExperimentStatus } from "@prisma/client";
import { EDITORIAL_METRICS, summarizeExperiment, type EditorialMetric, type ExposureWindow, type ExperimentObservation } from "@/lib/editorial-experimentation";
import { prisma } from "@/lib/prisma";

export async function recordExperimentEvaluationsForPost(postId: string): Promise<{ evaluated: number; newSnapshots: number }> {
  const experiments = await prisma.editorialExperiment.findMany({
    where: { posts: { some: { postId } } },
    include: { posts: { include: { post: { select: { publishedAt: true, language: true, formatType: true, editorialPillar: true, topic: true, metrics: {
      where: { availability: { in: ["AVAILABLE", "PARTIAL"] } }, orderBy: { capturedAt: "desc" }, take: 30,
      select: { measurementWindow: true, capturedAt: true, source: true, availability: true, impressions: true, membersReached: true, reactions: true, comments: true, shares: true, postSaves: true, profileViewsFromContent: true, outOfNetworkPercent: true, interactionRate: true },
    } } } } } },
  });
  let newSnapshots = 0;
  for (const experiment of experiments) {
    const criteria = experiment.comparisonCriteria && typeof experiment.comparisonCriteria === "object" && !Array.isArray(experiment.comparisonCriteria) ? experiment.comparisonCriteria as Record<string, unknown> : {};
    const metric: EditorialMetric = EDITORIAL_METRICS.includes(experiment.primaryMetric as EditorialMetric) ? experiment.primaryMetric as EditorialMetric : "impressions";
    const window: ExposureWindow = ["24H", "72H", "7D", "LIFETIME"].includes(String(criteria.measurementWindow)) ? criteria.measurementWindow as ExposureWindow : "7D";
    const observations: ExperimentObservation[] = experiment.posts.flatMap((link) => link.post.metrics.map((row) => ({
      postId: link.postId, armLabel: link.armLabel, publishedAt: link.post.publishedAt, language: link.post.language,
      formatType: link.post.formatType, pillar: link.post.editorialPillar, topic: link.post.topic,
      measurementWindow: row.measurementWindow, capturedAt: row.capturedAt, source: row.source, availability: row.availability,
      impressions: row.impressions, membersReached: row.membersReached, reactions: row.reactions, comments: row.comments, shares: row.shares,
      postSaves: row.postSaves, profileViewsFromContent: row.profileViewsFromContent, outOfNetworkPercent: row.outOfNetworkPercent, interactionRate: row.interactionRate,
    })));
    const results = summarizeExperiment({ observations, metric, window, minimumObservations: experiment.minimumObservations, startsAt: experiment.periodStart, endsAt: experiment.periodEnd });
    const secondaryAnalyses = (Array.isArray(experiment.secondaryMetrics) ? experiment.secondaryMetrics : []).filter((value): value is EditorialMetric => typeof value === "string" && EDITORIAL_METRICS.includes(value as EditorialMetric)).map((secondaryMetric) => summarizeExperiment({ observations, metric: secondaryMetric, window, minimumObservations: experiment.minimumObservations, startsAt: experiment.periodStart, endsAt: experiment.periodEnd }));
    const completeResults = { primary: results, secondary: secondaryAnalyses };
    const dataFingerprint = createHash("sha256").update(JSON.stringify({ metric, window, posts: observations.filter((row) => row.measurementWindow === window).map((row) => [row.postId, row.capturedAt, row[metric]]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), secondary: secondaryAnalyses.map((item) => item.coverage) })).digest("hex");
    const saved = await prisma.editorialExperimentEvaluation.createMany({ data: [{ experimentId: experiment.id, measurementWindow: window, metric, dataFingerprint, results: JSON.parse(JSON.stringify(completeResults)) }], skipDuplicates: true });
    newSnapshots += saved.count;
    if (experiment.status !== EditorialExperimentStatus.COMPLETED && experiment.status !== EditorialExperimentStatus.CANCELLED) {
      await prisma.editorialExperiment.update({ where: { id: experiment.id }, data: { status: results.status, results: JSON.parse(JSON.stringify(completeResults)), limitations: JSON.parse(JSON.stringify(results.limitations)) } });
    }
  }
  return { evaluated: experiments.length, newSnapshots };
}
