import { PostStatus } from "@prisma/client";
import { observedInteractionRate } from "@/lib/analytics-data";
import { buildExploratoryHypotheses, buildPerformanceComparisonGroups, type PerformanceSnapshot } from "@/lib/analytics-insights-core";
import { prisma } from "@/lib/prisma";

export { buildExploratoryHypotheses, buildPerformanceComparisonGroups } from "@/lib/analytics-insights-core";
export type { PerformanceSnapshot } from "@/lib/analytics-insights-core";

export async function getPerformanceInsights(now = new Date()) {
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [snapshots, qualifiedMatches, profileMetrics] = await Promise.all([
    prisma.postMetric.findMany({
      where: { post: { status: PostStatus.PUBLISHED }, source: { in: ["LINKEDIN_API", "MANUAL"] }, availability: { in: ["AVAILABLE", "PARTIAL"] } },
      orderBy: { capturedAt: "desc" }, take: 1000,
      include: { post: { select: { id: true, title: true, editorialPillar: true, formatType: true, language: true, topic: true, publishedAt: true, qualityScore: true, qualityStatus: true } } },
    }),
    prisma.jobMatch.findMany({ where: { score: { gte: 75 }, createdAt: { gte: periodStart } }, orderBy: { score: "desc" }, take: 20, select: { score: true, label: true, createdAt: true, job: { select: { title: true, company: true, url: true, location: true } } } }),
    prisma.profileMetric.findMany({ where: { source: { in: ["LINKEDIN_API", "MANUAL"] }, availability: "AVAILABLE" }, orderBy: { capturedAt: "desc" }, take: 100 }),
  ]);

  const latestByPostWindow = new Map<string, PerformanceSnapshot>();
  for (const snapshot of snapshots as PerformanceSnapshot[]) {
    const key = `${snapshot.postId}:${snapshot.measurementWindow}`;
    if (!latestByPostWindow.has(key)) latestByPostWindow.set(key, snapshot);
  }
  const latest = [...latestByPostWindow.values()];
  const matureWindowPriority = ["7D", "72H", "24H", "LIFETIME"];
  const latestByPost = new Map<string, PerformanceSnapshot>();
  for (const snapshot of latest) {
    const current = latestByPost.get(snapshot.postId);
    if (!current || matureWindowPriority.indexOf(snapshot.measurementWindow) < matureWindowPriority.indexOf(current.measurementWindow)) {
      latestByPost.set(snapshot.postId, snapshot);
    }
  }
  const matureSnapshots = [...latestByPost.values()];
  const sumMeasured = (key: "impressions" | "reactions" | "comments" | "shares" | "postSaves" | "postSends" | "linkClicks" | "profileViewsFromContent") => {
    const values = matureSnapshots.map((row) => row[key]).filter((value): value is number => value !== null);
    return { value: values.length ? values.reduce((sum, value) => sum + value, 0) : null, measuredPosts: values.length, totalPosts: matureSnapshots.length };
  };
  const groups = buildPerformanceComparisonGroups(latest);
  const trends = ([7, 14, 30] as const).map((days) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const windowSnapshots = latest.filter((row) => row.capturedAt.getTime() >= cutoff);
    const rates = windowSnapshots.map((row) => observedInteractionRate(row)).filter((value): value is number => value !== null);
    return {
      days,
      snapshots: windowSnapshots.length,
      posts: new Set(windowSnapshots.map((row) => row.postId)).size,
      measuredRates: rates.length,
      meanObservedInteractionRate: rates.length ? Number((rates.reduce((sum, rate) => sum + rate, 0) / rates.length).toFixed(3)) : null,
      note: rates.length >= 3 ? "descrição histórica; não causal" : "amostra insuficiente para tendência",
    };
  });
  const rankingWindow = matureWindowPriority.find((window) => matureSnapshots.some((row) => row.measurementWindow === window));
  const topPosts = matureSnapshots.filter((row) => row.measurementWindow === rankingWindow).map((metric) => ({ metric, interactionRate: observedInteractionRate(metric) }))
    .filter((entry): entry is { metric: PerformanceSnapshot; interactionRate: number } => entry.interactionRate !== null)
    .sort((a, b) => b.interactionRate - a.interactionRate).slice(0, 10)
    .map(({ metric, interactionRate }) => ({ postId: metric.postId, title: metric.post.title, pillar: metric.post.editorialPillar, format: metric.post.formatType, language: metric.post.language, topic: metric.post.topic, window: metric.measurementWindow, exposureHours: metric.exposureHours, source: metric.source, interactionRate, impressions: metric.impressions, membersReached: metric.membersReached, comments: metric.comments, shares: metric.shares, saves: metric.postSaves, profileViewsAttributed: metric.profileViewsFromContent }));

  const profileTypes = ["PROFILE_VIEWS", "FOLLOWERS", "SEARCH_APPEARANCES", "IMPRESSIONS_IN_NETWORK", "IMPRESSIONS_IN_NETWORK_PERCENT", "IMPRESSIONS_OUTSIDE_NETWORK", "IMPRESSIONS_OUTSIDE_NETWORK_PERCENT", "MEMBERS_REACHED_IN_NETWORK", "MEMBERS_REACHED_OUTSIDE_NETWORK"];
  const latestProfileMetrics = profileTypes.flatMap((metricType) => {
    const candidates = profileMetrics.filter((metric) => metric.metricType === metricType && (metric.periodEnd ?? metric.capturedAt) >= periodStart);
    const latest = candidates.sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0];
    return latest ? [{ metricType, value: latest.value, source: latest.source, sourceNote: latest.sourceNote, periodStart: latest.periodStart, periodEnd: latest.periodEnd, capturedAt: latest.capturedAt }] : [];
  });
  const hypotheses = buildExploratoryHypotheses(groups);
  const recommendations = topPosts.length
    ? [`Usar ${topPosts[0]!.format} sobre ${topPosts[0]!.topic ?? topPosts[0]!.pillar} como hipótese para novo teste; não atribuir causalidade a um único post.`, ...((hypotheses.length === 0) ? ["Manter variedade de temas e formatos: a amostra ainda não sustenta uma regra editorial dominante."] : [])]
    : ["Manter diversidade editorial e coletar observações comparáveis antes de mudar o calendário com base em performance."];

  return {
    generatedAt: now.toISOString(),
    period: { start: periodStart.toISOString(), end: now.toISOString() },
    totals: { impressions: sumMeasured("impressions"), reactions: sumMeasured("reactions"), comments: sumMeasured("comments"), shares: sumMeasured("shares"), postSaves: sumMeasured("postSaves"), postSends: sumMeasured("postSends"), linkClicks: sumMeasured("linkClicks"), profileViewsFromContent: sumMeasured("profileViewsFromContent") },
    postsWithMetrics: matureSnapshots.length,
    snapshots: latest.length,
    coverage: { apiSnapshots: latest.filter((row) => row.source === "LINKEDIN_API").length, manualSnapshots: latest.filter((row) => row.source === "MANUAL").length, legacyExcluded: true },
    comparisonsByExposureWindow: groups,
    trends,
    hypotheses,
    topPostsByObservedInteractionRate: topPosts,
    profileMetrics: latestProfileMetrics,
    qualifiedOpportunities: qualifiedMatches,
    recommendations,
    confidence: matureSnapshots.length >= 10 ? "moderada" : matureSnapshots.length >= 3 ? "baixa" : "muito baixa; amostra pequena",
  };
}

export function formatWeeklyPerformanceReport(report: Awaited<ReturnType<typeof getPerformanceInsights>>): string {
  const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const topLines = report.topPostsByObservedInteractionRate.slice(0, 3).map((post, index) => `${index + 1}. ${escapeHtml(post.title)} — ${post.interactionRate}% (${post.window}, idade observada ${post.exposureHours ?? "n/d"}h; ${post.impressions ?? "impressões indisponíveis"} impressões; alcance ${post.membersReached ?? "indisponível"})`);
  const hypothesisLines = report.hypotheses.slice(0, 3).map((item) => `• ${escapeHtml(item.hypothesis)} Evidência: ${item.evidence.leaderRate}% (n=${item.evidence.leaderN}) vs ${item.evidence.comparatorRate}% (n=${item.evidence.comparatorN}).`);
  return [
    "📊 <b>Aprendizado editorial semanal</b>",
    `Período: ${report.period.start.slice(0, 10)} a ${report.period.end.slice(0, 10)} (UTC). Confiança geral: ${report.confidence}.`,
    `Posts com snapshots válidos: ${report.postsWithMetrics}; snapshots analisados: ${report.snapshots}.`,
    `Origem: ${report.coverage.apiSnapshots} snapshots de API · ${report.coverage.manualSnapshots} manuais. Registros legados não são usados como observação.`,
    `Janelas históricas 7/14/30 dias: ${report.trends.map((trend) => `${trend.days}d=${trend.meanObservedInteractionRate === null ? "sem amostra" : `${trend.meanObservedInteractionRate}% (n=${trend.measuredRates})`}`).join(" · ")}.`,
    "", "<b>Melhores taxas observadas (não são previsões):</b>", ...(topLines.length ? topLines : ["Ainda não há dados completos suficientes para ordenar publicações."]),
    "", "<b>Hipóteses para testar (não conclusões):</b>", ...(hypothesisLines.length ? hypothesisLines : ["Amostra insuficiente; acumular publicações com janelas comparáveis antes de inferir diferenças."]),
    "", "<b>Descoberta e perfil (somente observações importadas/coletadas):</b>", ...(report.profileMetrics.length ? report.profileMetrics.map((metric) => `• ${escapeHtml(metric.metricType)}: ${metric.value ?? "indisponível"} (${escapeHtml(metric.sourceNote ?? metric.source)}, período ${metric.periodStart?.toISOString().slice(0, 10) ?? "n/d"}–${metric.periodEnd?.toISOString().slice(0, 10) ?? "n/d"}).`) : ["Sem métricas de perfil/distribuição registradas para o período; percentual e alcance fora da rede não foram estimados."]),
    `Oportunidades profissionais qualificadas registradas no período: ${report.qualifiedOpportunities.length}.`,
    "", "<b>Próximos testes editoriais:</b>", ...report.recommendations.map((item) => `• ${escapeHtml(item)}`),
    "", "Métrica ausente significa indisponibilidade, não zero. Distribuição externa só aparece quando a fonte autorizada a informa.",
  ].join("\n");
}
