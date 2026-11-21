import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "30");
  const format = url.searchParams.get("format") ?? "markdown";
  if (![30, 60, 90].includes(days) || !["markdown", "csv"].includes(format)) return NextResponse.json({ error: "Use days=30|60|90 e format=markdown|csv." }, { status: 400 });
  const end = new Date();
  const cycle = await prisma.editorialLearningCycle.findUnique({ where: { cycleKey: "primary" }, select: { startDate: true, timezone: true } });
  const start = cycle?.startDate ?? new Date(end.getTime() - days * 86_400_000);
  const milestoneAt = new Date(start.getTime() + days * 86_400_000);
  const milestoneReached = end.getTime() >= milestoneAt.getTime();
  const due = new Date(Math.min(end.getTime(), milestoneAt.getTime()));
  const [posts, outcomes, activities, experiments, recommendations, profileMetrics] = await Promise.all([
    prisma.post.findMany({ where: { status: "PUBLISHED", publishedAt: { gte: start, lte: due } }, select: { id: true, title: true, language: true, formatType: true, editorialPillar: true, editorialObjective: true, topic: true, publishedAt: true, qualityReview: true, creativeBriefs: { orderBy: { createdAt: "desc" }, take: 1, select: { evidence: { select: { factId: true, experienceId: true, projectId: true } } } }, metrics: { where: { availability: { in: ["AVAILABLE", "PARTIAL"] } }, orderBy: { capturedAt: "desc" }, select: { measurementWindow: true, capturedAt: true, source: true, audienceBreakdown: true, impressions: true, membersReached: true, impressionsOutOfNetwork: true, outOfNetworkPercent: true, reactions: true, comments: true, shares: true, postSaves: true, profileViewsFromContent: true, interactionRate: true } } } }),
    prisma.careerOutcome.findMany({ where: { occurredAt: { gte: start, lte: due } }, orderBy: { occurredAt: "desc" }, select: { company: true, roleTitle: true, type: true, origin: true, association: true, post: { select: { title: true } }, processStage: true, occurredAt: true } }),
    prisma.networkingActivity.findMany({ where: { occurredAt: { gte: start, lte: due } }, select: { type: true, occurredAt: true, topicKey: true, language: true, publicationConfirmed: true, newRelevantConnection: true, conversationStarted: true } }),
    prisma.editorialExperiment.findMany({ where: { periodStart: { lte: due }, periodEnd: { gte: start } }, select: { name: true, status: true, hypothesis: true, results: true, limitations: true, recommendation: true } }),
    prisma.editorialRecommendation.findMany({ where: { createdAt: { gte: start, lte: due } }, select: { title: true, status: true, justification: true, confidence: true, limitations: true, nextAction: true } }),
    prisma.profileMetric.findMany({ where: { capturedAt: { gte: start, lte: due }, availability: "AVAILABLE" }, orderBy: { capturedAt: "desc" }, select: { metricType: true, value: true, source: true, sourceNote: true, periodStart: true, periodEnd: true, capturedAt: true } }),
  ]);
  const audienceCriteria = await prisma.qualifiedAudienceCriteria.findUnique({ where: { key: "primary" }, select: { roles: true, markets: true } });
  const window = "7D";
  const latest = posts.flatMap((post) => {
    const row = post.metrics.find((metric) => metric.measurementWindow === window);
    return row ? [{ post, metric: row }] : [];
  });
  const avg = (values: Array<number | null>) => { const known = values.filter((value): value is number => value !== null); return known.length ? Number((known.reduce((a, b) => a + b, 0) / known.length).toFixed(2)) : null; };
  const summarizeDimension = (valueFor: (post: (typeof posts)[number]) => string | null) => {
    const groups = new Map<string, typeof latest>();
    for (const row of latest) { const value = valueFor(row.post); if (value) groups.set(value, [...(groups.get(value) ?? []), row]); }
    return [...groups.entries()].map(([label, rows]) => ({ label, n: rows.length, avgImpressions: avg(rows.map((x) => x.metric.impressions)), avgReachPerPost: avg(rows.map((x) => x.metric.membersReached)), avgProfileViews: avg(rows.map((x) => x.metric.profileViewsFromContent)), avgInteractionRate: avg(rows.map((x) => x.metric.interactionRate)) }));
  };
  const dimensionRows = (key: "language" | "formatType" | "editorialPillar" | "topic" | "editorialObjective") => summarizeDimension((post) => post[key]);
  const byEvidence = summarizeDimension((post) => { const evidence = post.creativeBriefs[0]?.evidence ?? []; return evidence.some((entry) => entry.projectId) ? "PORTFOLIO_PROJECT" : evidence.some((entry) => entry.experienceId) ? "PROFESSIONAL_EXPERIENCE" : evidence.some((entry) => entry.factId) ? "DOCUMENTED_FACT" : "NO_LINKED_EVIDENCE"; });
  const byHookQuality = summarizeDimension((post) => { const review = post.qualityReview && typeof post.qualityReview === "object" && !Array.isArray(post.qualityReview) ? post.qualityReview as Record<string, unknown> : {}; const intel = review.editorialIntelligence && typeof review.editorialIntelligence === "object" && !Array.isArray(review.editorialIntelligence) ? review.editorialIntelligence as Record<string, unknown> : {}; const hook = intel.hookQuality && typeof intel.hookQuality === "object" && !Array.isArray(intel.hookQuality) ? intel.hookQuality as Record<string, unknown> : {}; const score = typeof hook.score === "number" ? hook.score : typeof intel.hookQualityScore === "number" ? intel.hookQualityScore : null; return score === null ? null : score >= 75 ? "STRONG_75_PLUS" : score >= 50 ? "MID_50_74" : "LOW_BELOW_50"; });
  const qualifiedOutcomeCount = outcomes.filter((item) => ["RECRUITER_CONTACT", "HIRING_MANAGER_CONVERSATION", "INTERVIEW_INVITATION", "QUALIFIED_OPPORTUNITY"].includes(item.type)).length;
  const latestAudience = new Map<string, (typeof latest)[number]["metric"]>();
  for (const item of latest) if (!latestAudience.has(item.post.id)) latestAudience.set(item.post.id, item.metric);
  const roles = Array.isArray(audienceCriteria?.roles) ? audienceCriteria.roles.filter((item): item is string => typeof item === "string") : [];
  const markets = Array.isArray(audienceCriteria?.markets) ? audienceCriteria.markets.filter((item): item is string => typeof item === "string") : [];
  const audienceCounts = (field: "audienceRole" | "audienceCountry", targets: string[]) => {
    const counts = new Map<string, number>();
    for (const metric of latestAudience.values()) {
      const breakdown = metric.audienceBreakdown;
      if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) continue;
      const value = (breakdown as Record<string, unknown>)[field];
      if (typeof value === "string") counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([value]) => targets.some((target) => value.trim().toLocaleLowerCase("en-US") === target.trim().toLocaleLowerCase("en-US"))).map(([value, postSnapshots]) => ({ value, postSnapshots }));
  };
  const report = {
    period: { start: start.toISOString(), end: due.toISOString(), timezone: cycle?.timezone ?? "America/Sao_Paulo", requestedDays: days, milestoneStatus: milestoneReached ? "READY" : "PENDING", milestoneAt: milestoneAt.toISOString() },
    editorial: { postsPublished: posts.length, postsWith7dSnapshot: latest.length, snapshotCoverage: posts.length ? Number((latest.length / posts.length * 100).toFixed(1)) : null, byLanguage: dimensionRows("language"), byFormat: dimensionRows("formatType"), byPillar: dimensionRows("editorialPillar"), byTopic: dimensionRows("topic"), byObjective: dimensionRows("editorialObjective"), byEvidence: byEvidence, byHookQuality, windowsCompared: ["7D"], note: "Comparações por snapshot 7D; médias de alcance são por post e não representam pessoas únicas consolidadas." },
    discovery: { outOfNetworkPercent: avg(latest.map((x) => x.metric.outOfNetworkPercent)), outOfNetworkImpressions: avg(latest.map((x) => x.metric.impressionsOutOfNetwork)), profileMetrics: profileMetrics.map((m) => ({ ...m, value: m.value, source: m.sourceNote ?? m.source })), qualifiedAudience: { roleCategories: audienceCounts("audienceRole", roles), marketCategories: audienceCounts("audienceCountry", markets), samplePosts: latestAudience.size, methodology: "Correspondência exata de rótulos agregados com os critérios configurados; post-snapshots não equivalem a pessoas únicas." } },
    networking: { activities: activities.length, reviewed: activities.filter((a) => a.type === "DISCUSSION_REVIEWED").length, commentsPrepared: activities.filter((a) => a.type === "COMMENT_PREPARED").length, commentsConfirmed: activities.filter((a) => a.type === "COMMENT_PUBLISHED" && a.publicationConfirmed).length, relevantConnections: activities.filter((a) => a.newRelevantConnection).length, conversationsStarted: activities.filter((a) => a.conversationStarted).length, byTopic: Object.entries(activities.reduce<Record<string, number>>((acc, a) => { if (a.topicKey) acc[a.topicKey] = (acc[a.topicKey] ?? 0) + 1; return acc; }, {})), byLanguage: Object.entries(activities.reduce<Record<string, number>>((acc, a) => { if (a.language) acc[a.language] = (acc[a.language] ?? 0) + 1; return acc; }, {})) },
    career: { outcomes: outcomes.length, qualifiedSignals: qualifiedOutcomeCount, byOrigin: Object.entries(outcomes.reduce<Record<string, number>>((acc, outcome) => { acc[outcome.origin] = (acc[outcome.origin] ?? 0) + 1; return acc; }, {})), records: outcomes },
    experiments, recommendations,
    limitations: ["Resultados observacionais não provam causalidade.", "Métricas ausentes não são zero.", "Somente snapshots 7D são usados na comparação agregada.", "Impressões e alcance de posts distintos não são somados como usuários únicos.", "Dados de audiência dependem de disponibilidade real e origem informada.", "Associação com publicação só é considerada confirmada quando foi registrada explicitamente."],
  };
  if (format === "csv") {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["period_start", "period_end", "post_id", "title", "language", "format", "pillar", "topic", "objective", "window", "impressions", "members_reached", "out_of_network_percent", "profile_views", "interaction_rate", "source"]];
    for (const { post, metric } of latest) rows.push([start.toISOString(), due.toISOString(), post.id, post.title, post.language, post.formatType, post.editorialPillar, post.topic ?? "", post.editorialObjective ?? "", window, metric.impressions, metric.membersReached, metric.outOfNetworkPercent, metric.profileViewsFromContent, metric.interactionRate, metric.source].map(String));
    const csv = rows.map((row) => row.map(quote).join(",")).join("\r\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=editorial-report-${days}d.csv`, "Cache-Control": "no-store" } });
  }
  const lines = [
    `# Relatório editorial e de carreira — ${days} dias`,
    `Período: ${start.toISOString()} a ${due.toISOString()} (${report.period.timezone})`,
    `Marco D+${days}: ${report.period.milestoneStatus}${milestoneReached ? "" : `; data prevista ${milestoneAt.toISOString()}`}`,
    "",
    "## Resumo executivo",
    `Publicações: ${posts.length}; com snapshot 7D: ${latest.length} (${report.editorial.snapshotCoverage ?? "indisponível"}% de cobertura).`,
    `Sinais de carreira qualificados registrados: ${qualifiedOutcomeCount}; origem e associação são preservadas por registro.`,
    `Networking: ${activities.length} atividades; ${report.networking.commentsConfirmed} comentários confirmados manualmente; ${report.networking.relevantConnections} conexões relevantes; ${report.networking.conversationsStarted} conversas iniciadas.`,
    "",
    "## Desempenho editorial por idioma, formato, pilar, tema e objetivo",
    ...([ ["Idioma", report.editorial.byLanguage], ["Formato", report.editorial.byFormat], ["Pilar", report.editorial.byPillar], ["Tema", report.editorial.byTopic], ["Objetivo", report.editorial.byObjective], ["Evidência", report.editorial.byEvidence], ["Qualidade do hook", report.editorial.byHookQuality] ] as const).flatMap(([label, entries]) => [`### ${label}`, ...(entries.length ? entries.map((entry) => `- ${entry.label}: n=${entry.n}; média de impressões ${entry.avgImpressions ?? "n/d"}; alcance médio por post ${entry.avgReachPerPost ?? "n/d"}; visitas ao perfil ${entry.avgProfileViews ?? "n/d"}; interação ${entry.avgInteractionRate ?? "n/d"}.`) : ["- Dados insuficientes."])]),
    "",
    "## Descoberta profissional",
    `Percentual fora da rede observado: ${report.discovery.outOfNetworkPercent ?? "indisponível"}; impressões fora da rede (média por post): ${report.discovery.outOfNetworkImpressions ?? "indisponível"}.`,
    `Categorias profissionais coincidentes: ${JSON.stringify(report.discovery.qualifiedAudience.roleCategories)}; mercados: ${JSON.stringify(report.discovery.qualifiedAudience.marketCategories)} (n=${report.discovery.qualifiedAudience.samplePosts} post-snapshots).`,
    `Métricas de perfil importadas/coletadas: ${profileMetrics.length}.`,
    "",
    "## Experimentos e hipóteses",
    ...(experiments.length ? experiments.map((experiment) => `- ${experiment.name}: ${experiment.status}. Hipótese: ${experiment.hypothesis}. Limitações: ${JSON.stringify(experiment.limitations ?? [])}`) : ["Nenhum experimento registrado neste período."]),
    "",
    "## Resultados de carreira",
    ...(outcomes.length ? outcomes.map((outcome) => `- ${outcome.occurredAt.toISOString().slice(0, 10)} — ${outcome.type}; ${outcome.roleTitle ?? "cargo não informado"}; origem ${outcome.origin}; associação ${outcome.association}; ${outcome.post?.title ? `post: ${outcome.post.title}` : "sem associação confirmada a post"}.`) : ["Nenhum resultado profissional registrado no período."]),
    "",
    "## Recomendações",
    ...(recommendations.length ? recommendations.map((recommendation) => `- ${recommendation.title} [${recommendation.status}, confiança ${recommendation.confidence}]: ${recommendation.justification} Próxima ação: ${recommendation.nextAction}`) : ["Não há recomendações salvas; a amostra pode ser insuficiente."]),
    "",
    "## Limitações",
    ...report.limitations.map((item) => `- ${item}`),
    "",
    "Este relatório é descritivo. Não alterou calendário, posts, networking ou candidaturas.",
  ];
  return new NextResponse(lines.join("\n"), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename=editorial-report-${days}d.md`, "Cache-Control": "no-store" } });
}
