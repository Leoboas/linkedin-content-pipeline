import { observedInteractionRate } from "@/lib/analytics-data";

export type PerformanceSnapshot = {
  postId: string;
  measurementWindow: string;
  exposureHours: number | null;
  impressions: number | null;
  membersReached: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  postSaves: number | null;
  postSends: number | null;
  linkClicks: number | null;
  profileViewsFromContent: number | null;
  engagementScore: number | null;
  capturedAt: Date;
  source: string;
  post: { id: string; title: string; editorialPillar: string; formatType: string; language: string; topic: string | null; publishedAt: Date | null; qualityScore: number | null; qualityStatus: string | null };
};

export function buildPerformanceComparisonGroups(snapshots: PerformanceSnapshot[]) {
  const groups = new Map<string, { window: string; dimension: string; value: string; postIds: Set<string>; rates: number[]; impressions: number[]; comments: number[]; shares: number[]; saves: number[]; profileViews: number[]; exposureHours: number[] }>();
  for (const snapshot of snapshots) {
    const interactionRate = observedInteractionRate(snapshot);
    for (const [dimension, value] of [["pilar", snapshot.post.editorialPillar], ["formato", snapshot.post.formatType], ["idioma", snapshot.post.language], ["tema", snapshot.post.topic ?? "sem tema estruturado"]] as const) {
      const key = `${snapshot.measurementWindow}:${dimension}:${value}`;
      const group = groups.get(key) ?? { window: snapshot.measurementWindow, dimension, value, postIds: new Set<string>(), rates: [], impressions: [], comments: [], shares: [], saves: [], profileViews: [], exposureHours: [] };
      group.postIds.add(snapshot.postId);
      if (interactionRate !== null) group.rates.push(interactionRate);
      if (snapshot.impressions !== null) group.impressions.push(snapshot.impressions);
      if (snapshot.comments !== null) group.comments.push(snapshot.comments);
      if (snapshot.shares !== null) group.shares.push(snapshot.shares);
      if (snapshot.postSaves !== null) group.saves.push(snapshot.postSaves);
      if (snapshot.profileViewsFromContent !== null) group.profileViews.push(snapshot.profileViewsFromContent);
      if (snapshot.exposureHours !== null) group.exposureHours.push(snapshot.exposureHours);
      groups.set(key, group);
    }
  }
  const avg = (values: number[]) => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : null;
  return [...groups.values()].map((group) => ({
    window: group.window, dimension: group.dimension, value: group.value, sampleSize: group.postIds.size,
    measuredRateSample: group.rates.length, meanInteractionRate: avg(group.rates), meanExposureHours: avg(group.exposureHours), meanImpressions: avg(group.impressions),
    meanComments: avg(group.comments), meanShares: avg(group.shares), meanSaves: avg(group.saves), meanProfileViewsAttributed: avg(group.profileViews),
  })).sort((a, b) => a.window.localeCompare(b.window) || a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value));
}

export function buildExploratoryHypotheses(groups: ReturnType<typeof buildPerformanceComparisonGroups>) {
  const byDimension = new Map<string, typeof groups>();
  for (const group of groups) {
    if (group.sampleSize < 3 || group.meanInteractionRate === null) continue;
    const key = `${group.window}:${group.dimension}`;
    byDimension.set(key, [...(byDimension.get(key) ?? []), group]);
  }
  return [...byDimension.entries()].flatMap(([key, entries]) => {
    if (entries.length < 2) return [];
    const sorted = [...entries].sort((a, b) => (b.meanInteractionRate ?? -Infinity) - (a.meanInteractionRate ?? -Infinity));
    const [leader, comparator] = sorted;
    return [{ windowAndDimension: key, hypothesis: `Investigar se ${leader.value} se associa a uma taxa de interação observada maior que ${comparator.value}.`, evidence: { leaderRate: leader.meanInteractionRate, comparatorRate: comparator.meanInteractionRate, leaderN: leader.sampleSize, comparatorN: comparator.sampleSize }, confidence: "exploratória; não é conclusão causal", nextTest: "Alternar uma variável editorial por vez e comparar posts com a mesma janela de exposição." }];
  });
}
