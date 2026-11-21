import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { CareerOutcomeAssociation, CareerOutcomeOrigin, CareerOutcomeStage, CareerOutcomeType, EditorialExperimentStatus, Prisma } from "@prisma/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { buildWeeklyEditorialTimeline, cyclePhase, EDITORIAL_METRICS, summarizeExperiment, validateFixedEditorialDistribution, validateOutcomeAssociation, type EditorialMetric, type ExposureWindow, type ExperimentObservation } from "@/lib/editorial-experimentation";
import { prisma } from "@/lib/prisma";
import { recordExperimentEvaluationsForPost } from "@/lib/experimentation-persistence";

export const dynamic = "force-dynamic";
const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const cleanText = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const validDate = (value: unknown): Date | null => { if (typeof value !== "string") return null; const d = new Date(value); return Number.isFinite(d.getTime()) ? d : null; };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  try {
    const [cycle, editorialLine, criteria, experiments, recommendations, outcomes, publishedPosts, applications, activities] = await Promise.all([
      prisma.editorialLearningCycle.findUnique({ where: { cycleKey: "primary" } }),
      prisma.editorialLine.findFirst({ orderBy: { updatedAt: "desc" }, select: { postsPerWeek: true, languageDistribution: true, weeklySchedule: true } }),
      prisma.qualifiedAudienceCriteria.findUnique({ where: { key: "primary" } }),
      prisma.editorialExperiment.findMany({
        orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }], take: 50,
        include: {
          evaluations: { orderBy: { observedAt: "desc" }, take: 10 },
          posts: { include: { post: { select: {
            id: true, title: true, status: true, publishedAt: true, language: true, editorialPillar: true,
            formatType: true, topic: true, editorialObjective: true,
            metrics: { where: { availability: { in: ["AVAILABLE", "PARTIAL"] } }, orderBy: { capturedAt: "desc" }, take: 12,
              select: { measurementWindow: true, capturedAt: true, source: true, availability: true, impressions: true, membersReached: true, reactions: true, comments: true, shares: true, postSaves: true, profileViewsFromContent: true, outOfNetworkPercent: true, interactionRate: true } },
          } } } },
        },
      }),
      prisma.editorialRecommendation.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      prisma.careerOutcome.findMany({ orderBy: { occurredAt: "desc" }, take: 100, include: { post: { select: { id: true, title: true } }, networkingActivity: { select: { id: true, type: true, occurredAt: true } }, jobApplication: { select: { id: true, status: true, job: { select: { title: true, company: true } } } } } }),
      prisma.post.findMany({ where: { status: "PUBLISHED", publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, take: 200, select: { id: true, title: true, language: true, editorialPillar: true, formatType: true, topic: true, editorialObjective: true, publishedAt: true } }),
      prisma.jobApplication.findMany({ orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, status: true, updatedAt: true, job: { select: { title: true, company: true } } } }),
      prisma.networkingActivity.findMany({ orderBy: { occurredAt: "desc" }, take: 500, select: { id: true, type: true, occurredAt: true, topicKey: true, language: true, publicationConfirmed: true, newRelevantConnection: true, conversationStarted: true } }),
    ]);
    const learningCycle = cycle ?? null;
    const now = new Date();
    const cycleStart = cycle?.startDate ?? null;
    const audienceSince = cycleStart ?? new Date(now.getTime() - 90 * 86_400_000);
    const [audienceMetrics, timelinePosts] = await Promise.all([prisma.postMetric.findMany({
      where: { measurementWindow: "7D", availability: { in: ["AVAILABLE", "PARTIAL"] }, capturedAt: { lte: now }, post: { status: "PUBLISHED", publishedAt: { gte: audienceSince, lte: now } } },
      orderBy: { capturedAt: "desc" }, take: 2_000,
      select: { postId: true, audienceBreakdown: true, capturedAt: true },
    }), prisma.post.findMany({ where: { status: "PUBLISHED", publishedAt: { gte: audienceSince, lte: now } }, select: { id: true, publishedAt: true, metrics: { where: { measurementWindow: "7D", availability: { in: ["AVAILABLE", "PARTIAL"] } }, orderBy: { capturedAt: "desc" }, take: 1, select: { measurementWindow: true, impressions: true, membersReached: true, profileViewsFromContent: true, outOfNetworkPercent: true } } } })]);
    const latestAudienceByPost = new Map<string, (typeof audienceMetrics)[number]>();
    for (const item of audienceMetrics) if (!latestAudienceByPost.has(item.postId)) latestAudienceByPost.set(item.postId, item);
    const audienceRoles = Array.isArray(criteria?.roles) ? criteria.roles.filter((item): item is string => typeof item === "string") : ["Data Engineer", "Backend Engineer", "Senior Software Engineer", "Staff Engineer", "Principal Engineer", "Tech Lead", "Software Architect", "Engineering Manager", "Hiring Manager", "Technical Recruiter"];
    const audienceMarkets = Array.isArray(criteria?.markets) ? criteria.markets.filter((item): item is string => typeof item === "string") : ["BR", "US", "EU"];
    const normalizeAudience = (value: string) => value.trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
    const roleCounts = new Map<string, number>(); const marketCounts = new Map<string, number>();
    for (const item of latestAudienceByPost.values()) {
      if (!isRecord(item.audienceBreakdown)) continue;
      const role = item.audienceBreakdown.audienceRole;
      const market = item.audienceBreakdown.audienceCountry;
      if (typeof role === "string") roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
      if (typeof market === "string") marketCounts.set(market, (marketCounts.get(market) ?? 0) + 1);
    }
    const matchedRoleCategories = [...roleCounts.entries()].filter(([role]) => audienceRoles.some((target) => normalizeAudience(role) === normalizeAudience(target))).map(([role, postSnapshots]) => ({ role, postSnapshots }));
    const matchedMarketCategories = [...marketCounts.entries()].filter(([market]) => audienceMarkets.some((target) => normalizeAudience(market) === normalizeAudience(target))).map(([market, postSnapshots]) => ({ market, postSnapshots }));
    const daysElapsed = cycleStart ? Math.max(0, Math.min(90, Math.floor((now.getTime() - cycleStart.getTime()) / 86_400_000))) : null;
    const experience = experiments.map((experiment) => {
      const criteriaJson = isRecord(experiment.comparisonCriteria) ? experiment.comparisonCriteria : {};
      const metric = EDITORIAL_METRICS.includes(experiment.primaryMetric as EditorialMetric) ? experiment.primaryMetric as EditorialMetric : "impressions";
      const window = ["24H", "72H", "7D", "LIFETIME"].includes(String(criteriaJson.measurementWindow)) ? String(criteriaJson.measurementWindow) as ExposureWindow : "7D";
      const observations: ExperimentObservation[] = experiment.posts.flatMap((link) => link.post.metrics.map((m) => ({
        postId: link.postId, armLabel: link.armLabel, publishedAt: link.post.publishedAt, language: link.post.language,
        formatType: link.post.formatType, pillar: link.post.editorialPillar, topic: link.post.topic,
        measurementWindow: m.measurementWindow, capturedAt: m.capturedAt, source: m.source, availability: m.availability,
        impressions: m.impressions, membersReached: m.membersReached, reactions: m.reactions, comments: m.comments, shares: m.shares,
        postSaves: m.postSaves, profileViewsFromContent: m.profileViewsFromContent, outOfNetworkPercent: m.outOfNetworkPercent, interactionRate: m.interactionRate,
      })));
      const analysis = summarizeExperiment({ observations, metric, window, minimumObservations: experiment.minimumObservations, startsAt: experiment.periodStart, endsAt: experiment.periodEnd, now });
      const secondaryAnalyses = (Array.isArray(experiment.secondaryMetrics) ? experiment.secondaryMetrics : []).filter((value): value is EditorialMetric => typeof value === "string" && EDITORIAL_METRICS.includes(value as EditorialMetric)).map((secondaryMetric) => summarizeExperiment({ observations, metric: secondaryMetric, window, minimumObservations: experiment.minimumObservations, startsAt: experiment.periodStart, endsAt: experiment.periodEnd, now }));
      return { ...experiment, analysis, secondaryAnalyses };
    });
    const activeActivities = cycleStart ? activities.filter((item) => item.occurredAt >= cycleStart) : activities;
    const publishedInCycle = cycleStart ? publishedPosts.filter((post) => post.publishedAt && post.publishedAt >= cycleStart) : [];
    const langCount = (language: string) => publishedInCycle.filter((post) => post.language.toLowerCase().startsWith(language.toLowerCase())).length;
    const elapsedWeeks = daysElapsed === null ? 0 : Math.ceil(daysElapsed / 7);
    return NextResponse.json({
      cycle: learningCycle ? { ...learningCycle, phase: cyclePhase(learningCycle.startDate, now), daysElapsed, daysRemaining: Math.max(0, 90 - (daysElapsed ?? 0)), plannedPosts: elapsedWeeks * 4, publishedPosts: publishedInCycle.length, distribution: { en: langCount("en"), ptBr: langCount("pt") } } : null,
      currentEditorialConfig: editorialLine,
      criteria: criteria ?? { roles: ["Data Engineer", "Backend Engineer", "Senior Software Engineer", "Staff Engineer", "Principal Engineer", "Tech Lead", "Software Architect", "Engineering Manager", "Hiring Manager", "Technical Recruiter"], markets: ["BR", "US", "EU"] },
      experiments: experience,
      recommendations,
      outcomes,
      networking: {
        totalActivities: activeActivities.length,
        discussionsReviewed: activeActivities.filter((a) => a.type === "DISCUSSION_REVIEWED").length,
        commentsPrepared: activeActivities.filter((a) => a.type === "COMMENT_PREPARED").length,
        manuallyConfirmedComments: activeActivities.filter((a) => a.type === "COMMENT_PUBLISHED" && a.publicationConfirmed).length,
        relevantConnections: activeActivities.filter((a) => a.newRelevantConnection).length,
        conversationsStarted: activeActivities.filter((a) => a.conversationStarted).length,
        byTopic: Object.entries(activeActivities.reduce<Record<string, number>>((acc, a) => { if (a.topicKey) acc[a.topicKey] = (acc[a.topicKey] ?? 0) + 1; return acc; }, {})),
        byLanguage: Object.entries(activeActivities.reduce<Record<string, number>>((acc, a) => { if (a.language) acc[a.language] = (acc[a.language] ?? 0) + 1; return acc; }, {})),
      },
      weeklyTimeline: buildWeeklyEditorialTimeline({
        posts: timelinePosts.flatMap((post) => post.publishedAt ? [{ postId: post.id, publishedAt: post.publishedAt, impressions: post.metrics[0]?.impressions ?? null, membersReached: post.metrics[0]?.membersReached ?? null, profileViewsFromContent: post.metrics[0]?.profileViewsFromContent ?? null, outOfNetworkPercent: post.metrics[0]?.outOfNetworkPercent ?? null, window: post.metrics[0]?.measurementWindow ?? "NONE" }] : []),
        activities: activeActivities,
        outcomes: outcomes.filter((outcome) => outcome.occurredAt >= audienceSince && outcome.occurredAt <= now).map((outcome) => ({ occurredAt: outcome.occurredAt, type: outcome.type, origin: outcome.origin, association: outcome.association })),
      }),
      career: { applicationCount: applications.length, applications: applications.slice(0, 20), outcomesCount: outcomes.length, qualifiedAudience: criteria ?? null },
      qualifiedAudience: { status: latestAudienceByPost.size ? "AVAILABLE" : "INSUFFICIENT_DATA", snapshotPosts: latestAudienceByPost.size, matchedRoleCategories, matchedMarketCategories, criteria: { roles: audienceRoles, markets: audienceMarkets }, methodology: "Correspondência exata entre categorias agregadas importadas e critérios definidos; contagem é de snapshots de posts, não pessoas únicas. Categorias ausentes não são inferidas." },
      publishedPosts: publishedPosts.slice(0, 100),
      networkingActivities: activities.slice(0, 100),
      limitations: ["Snapshots ausentes não são zero.", "Alcance de posts distintos não é somado como pessoas únicas.", "Resultados e associações são observacionais; não demonstram causalidade.", "Dados demográficos só são exibidos quando a fonte autorizada os fornece.", "Nenhuma ação editorial ou alteração de calendário é aplicada automaticamente."],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[experimentation] read failed", error instanceof Error ? error.name : "unknown");
    return jsonError("Não foi possível carregar a inteligência editorial.", 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonError("JSON inválido."); }
  try {
    if (body.action === "start-cycle") {
      const startDate = validDate(body.startDate);
      if (!startDate) return jsonError("Informe a data inicial do ciclo.");
      const config = await prisma.editorialLine.findFirst({ orderBy: { updatedAt: "desc" }, select: { postsPerWeek: true, languageDistribution: true, weeklySchedule: true } });
      const distribution = isRecord(config?.languageDistribution) ? config.languageDistribution : { "en-US": 2, "pt-BR": 2 };
      if (!validateFixedEditorialDistribution(config?.postsPerWeek ?? 4, distribution)) return jsonError("A configuração editorial atual não corresponde a 4 posts semanais (2 EN + 2 PT-BR). O ciclo não alterou nem sobrescreveu essa configuração.", 409);
      const cycle = await prisma.editorialLearningCycle.upsert({ where: { cycleKey: "primary" }, create: { cycleKey: "primary", startDate, plannedPostsPerWeek: 4, languageDistribution: json(distribution), scheduleSnapshot: json(config?.weeklySchedule ?? []) }, update: { startDate, plannedPostsPerWeek: 4, languageDistribution: json(distribution), scheduleSnapshot: json(config?.weeklySchedule ?? []) } });
      return NextResponse.json({ cycle }, { status: 201 });
    }
    if (body.action === "save-audience-criteria") {
      const roles = Array.isArray(body.roles) ? [...new Set(body.roles.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 120)).filter(Boolean))].slice(0, 40) : [];
      const markets = Array.isArray(body.markets) ? [...new Set(body.markets.filter((v): v is string => typeof v === "string").map((v) => v.trim().toUpperCase().slice(0, 30)).filter(Boolean))].slice(0, 20) : [];
      if (!roles.length || !markets.length) return jsonError("Informe ao menos um cargo e um mercado-alvo.");
      const criteria = await prisma.qualifiedAudienceCriteria.upsert({ where: { key: "primary" }, create: { key: "primary", roles: json(roles), markets: json(markets) }, update: { roles: json(roles), markets: json(markets) } });
      return NextResponse.json({ criteria });
    }
    if (body.action === "create-experiment") {
      const name = cleanText(body.name, 160), hypothesis = cleanText(body.hypothesis, 2_000), objective = cleanText(body.professionalObjective, 500), variable = cleanText(body.variableTested, 100), metric = typeof body.primaryMetric === "string" && EDITORIAL_METRICS.includes(body.primaryMetric as EditorialMetric) ? body.primaryMetric : null;
      const start = validDate(body.periodStart), end = validDate(body.periodEnd);
      const minimum = typeof body.minimumObservations === "number" && Number.isInteger(body.minimumObservations) ? body.minimumObservations : 4;
      if (!name || !hypothesis || !objective || !variable || !metric || !start || !end || start > end || minimum < 2 || minimum > 20) return jsonError("Dados do experimento inválidos. Mínimo de observações deve ficar entre 2 e 20.");
      const requestedPosts = Array.isArray(body.posts) ? body.posts.filter(isRecord) : [];
      const postIds = [...new Set(requestedPosts.map((p) => cleanText(p.postId, 50)).filter((v): v is string => Boolean(v)))];
      if (postIds.length) {
        const posts = await prisma.post.findMany({ where: { id: { in: postIds }, status: "PUBLISHED", publishedAt: { not: null } }, select: { id: true } });
        if (posts.length !== postIds.length) return jsonError("Experimentos aceitam apenas posts publicados existentes.");
      }
      const arms = requestedPosts.map((post) => ({ postId: cleanText(post.postId, 50)!, armLabel: cleanText(post.armLabel, 100) ?? "Unassigned", notes: cleanText(post.notes, 500) }));
      if (new Set(arms.map((arm) => arm.postId)).size !== arms.length) return jsonError("Cada post só pode pertencer a um grupo dentro do experimento.");
      if (new Set(arms.map((a) => a.armLabel)).size < 2 && arms.length) return jsonError("Associe posts a pelo menos dois grupos/variações comparáveis.");
      const experiment = await prisma.editorialExperiment.create({ data: { name, hypothesis, professionalObjective: objective, primaryMetric: metric, secondaryMetrics: json(Array.isArray(body.secondaryMetrics) ? body.secondaryMetrics.filter((v): v is string => typeof v === "string" && EDITORIAL_METRICS.includes(v as EditorialMetric)) : []), variableTested: variable, periodStart: start, periodEnd: end, minimumObservations: minimum, comparisonCriteria: json({ measurementWindow: ["24H", "72H", "7D", "LIFETIME"].includes(String(body.measurementWindow)) ? body.measurementWindow : "7D", ...(isRecord(body.comparisonCriteria) ? body.comparisonCriteria : {}) }), posts: { create: arms } } });
      for (const postId of postIds) {
        try { await recordExperimentEvaluationsForPost(postId); }
        catch (error) { console.warn("[experimentation] created experiment; initial evaluation deferred", error instanceof Error ? error.name : "unknown"); }
      }
      return NextResponse.json({ experiment }, { status: 201 });
    }
    if (body.action === "link-post") {
      const experimentId = cleanText(body.experimentId, 50), postId = cleanText(body.postId, 50), armLabel = cleanText(body.armLabel, 100);
      if (!experimentId || !postId || !armLabel) return jsonError("Informe experimento, post e grupo.");
      const [experiment, post] = await Promise.all([prisma.editorialExperiment.findUnique({ where: { id: experimentId }, select: { id: true, status: true } }), prisma.post.findUnique({ where: { id: postId }, select: { id: true, status: true, publishedAt: true } })]);
      if (!experiment || !post) return jsonError("Experimento ou post não encontrado.", 404);
      if (post.status !== "PUBLISHED" || !post.publishedAt) return jsonError("Somente publicações efetivamente publicadas podem participar.");
      const link = await prisma.editorialExperimentPost.upsert({ where: { experimentId_postId: { experimentId, postId } }, create: { experimentId, postId, armLabel }, update: { armLabel, notes: cleanText(body.notes, 500) } });
      try { await recordExperimentEvaluationsForPost(postId); }
      catch (error) { console.warn("[experimentation] linked post; evaluation refresh deferred", error instanceof Error ? error.name : "unknown"); }
      return NextResponse.json({ link });
    }
    if (body.action === "create-outcome") {
      const type = Object.values(CareerOutcomeType).includes(body.type as CareerOutcomeType) ? body.type as CareerOutcomeType : null;
      const origin = Object.values(CareerOutcomeOrigin).includes(body.origin as CareerOutcomeOrigin) ? body.origin as CareerOutcomeOrigin : CareerOutcomeOrigin.UNKNOWN;
      const association = Object.values(CareerOutcomeAssociation).includes(body.association as CareerOutcomeAssociation) ? body.association as CareerOutcomeAssociation : CareerOutcomeAssociation.UNLINKED;
      const stage = Object.values(CareerOutcomeStage).includes(body.processStage as CareerOutcomeStage) ? body.processStage as CareerOutcomeStage : CareerOutcomeStage.UNKNOWN;
      const occurredAt = validDate(body.occurredAt);
      const postId = cleanText(body.postId, 50), networkingActivityId = cleanText(body.networkingActivityId, 50), jobApplicationId = cleanText(body.jobApplicationId, 50);
      if (!type || !occurredAt) return jsonError("Tipo e data do resultado são obrigatórios.");
      const evidenceNote = cleanText(body.evidenceNote, 1_000);
      const associationError = validateOutcomeAssociation({ origin, association, postId, networkingActivityId, evidenceNote });
      if (associationError) return jsonError(associationError);
      const [post, activity, application] = await Promise.all([
        postId ? prisma.post.findUnique({ where: { id: postId }, select: { id: true, status: true } }) : null,
        networkingActivityId ? prisma.networkingActivity.findUnique({ where: { id: networkingActivityId }, select: { id: true } }) : null,
        jobApplicationId ? prisma.jobApplication.findUnique({ where: { id: jobApplicationId }, select: { id: true } }) : null,
      ]);
      if (postId && !post) return jsonError("Publicação relacionada não encontrada.", 404);
      if (post && post.status !== "PUBLISHED") return jsonError("Somente publicação publicada pode ser vinculada a um resultado.");
      if (networkingActivityId && !activity) return jsonError("Atividade de networking não encontrada.", 404);
      if (jobApplicationId && !application) return jsonError("Candidatura não encontrada.", 404);
      const payload = { company: cleanText(body.company, 160), contactName: cleanText(body.contactName, 160), contactRole: cleanText(body.contactRole, 160), roleTitle: cleanText(body.roleTitle, 200), market: cleanText(body.market, 60), occurredAt, type, origin, association, postId, networkingActivityId, jobApplicationId, processStage: stage, observation: cleanText(body.observation, 2_000), result: cleanText(body.result, 1_000), evidenceNote };
      const idempotencyKey = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      const outcome = await prisma.careerOutcome.upsert({ where: { idempotencyKey }, create: { ...payload, idempotencyKey }, update: {} });
      return NextResponse.json({ outcome }, { status: 201 });
    }
    if (body.action === "generate-recommendations") {
      const to = new Date(), from = new Date(to.getTime() - 90 * 86_400_000);
      const existingCycle = await prisma.editorialLearningCycle.findUnique({ where: { cycleKey: "primary" }, select: { startDate: true } });
      const periodStart = existingCycle?.startDate ?? from;
      const posts = await prisma.post.findMany({ where: { status: "PUBLISHED", publishedAt: { gte: periodStart, lte: to } }, select: { id: true, language: true, formatType: true, editorialPillar: true, editorialObjective: true, topic: true, qualityReview: true, creativeBriefs: { orderBy: { createdAt: "desc" }, take: 1, select: { evidence: { select: { factId: true, experienceId: true, projectId: true } }, visualBrief: true } }, metrics: { where: { measurementWindow: "7D", availability: { in: ["AVAILABLE", "PARTIAL"] }, capturedAt: { gte: periodStart, lte: to } }, orderBy: { capturedAt: "desc" }, take: 1, select: { interactionRate: true, profileViewsFromContent: true, membersReached: true, capturedAt: true, source: true } } } });
      const dimensions = [
        { key: "language", metric: "profileViewsFromContent" as const, value: (p: typeof posts[number]) => p.language },
        { key: "visualFormat", metric: "interactionRate" as const, value: (p: typeof posts[number]) => { const visual = p.creativeBriefs[0]?.visualBrief; return isRecord(visual) && typeof visual.format === "string" ? visual.format : p.formatType; } },
        { key: "pillar", metric: "membersReached" as const, value: (p: typeof posts[number]) => p.editorialPillar },
        { key: "topic", metric: "interactionRate" as const, value: (p: typeof posts[number]) => p.topic },
        { key: "objective", metric: "profileViewsFromContent" as const, value: (p: typeof posts[number]) => p.editorialObjective },
        { key: "evidenceType", metric: "profileViewsFromContent" as const, value: (p: typeof posts[number]) => { const evidence = p.creativeBriefs[0]?.evidence ?? []; if (evidence.some((item) => item.projectId)) return "PORTFOLIO_PROJECT"; if (evidence.some((item) => item.experienceId)) return "PROFESSIONAL_EXPERIENCE"; if (evidence.some((item) => item.factId)) return "DOCUMENTED_FACT"; return "NO_LINKED_EVIDENCE"; } },
        { key: "hookQualityBand", metric: "interactionRate" as const, value: (p: typeof posts[number]) => { const review = isRecord(p.qualityReview) ? p.qualityReview : {}; const intel = isRecord(review.editorialIntelligence) ? review.editorialIntelligence : {}; const hook = isRecord(intel.hookQuality) ? intel.hookQuality : {}; const score = typeof hook.score === "number" ? hook.score : typeof intel.hookQualityScore === "number" ? intel.hookQualityScore : null; return score === null ? null : score >= 75 ? "STRONG_75_PLUS" : score >= 50 ? "MID_50_74" : "LOW_BELOW_50"; } },
      ];
      const candidates: Array<{ dimension: string; value: string; metric: typeof dimensions[number]["metric"]; selected: { n: number; mean: number; postIds: string[] }; comparison: { n: number; mean: number; postIds: string[] }; sources: string[] }> = [];
      for (const dimension of dimensions) {
        const groups = new Map<string, Array<{ label: string; value: number; postId: string; source: string }>>();
        const validRows: Array<{ label: string; value: number; postId: string; source: string }> = [];
        for (const post of posts) {
          const value = post.metrics[0]?.[dimension.metric];
          const label = dimension.value(post)?.trim();
          if (typeof value !== "number" || !Number.isFinite(value) || !label) continue;
          const row = { label, value, postId: post.id, source: post.metrics[0]!.source };
          validRows.push(row);
          const group = groups.get(label) ?? []; group.push(row); groups.set(label, group);
        }
        for (const [label, rows] of groups) {
          const comparisonRows = validRows.filter((r) => r.label !== label);
          const values = rows.map((r) => r.value);
          const comparison = comparisonRows.map((r) => r.value);
          if (values.length < 4 || comparison.length < 4) continue;
          candidates.push({ dimension: dimension.key, value: label, metric: dimension.metric, selected: { n: values.length, mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)), postIds: rows.map((row) => row.postId) }, comparison: { n: comparison.length, mean: Number((comparison.reduce((a, b) => a + b, 0) / comparison.length).toFixed(2)), postIds: comparisonRows.map((row) => row.postId) }, sources: [...new Set([...rows, ...comparisonRows].map((row) => row.source))].sort() });
        }
      }
      const { buildRecommendationCandidate } = await import("@/lib/editorial-experimentation");
      const created = [];
      for (const item of candidates.slice(0, 12)) {
        const recommendation = buildRecommendationCandidate({ ...item, window: "7D", periodStart, periodEnd: to });
        created.push(await prisma.editorialRecommendation.upsert({ where: { recommendationKey: recommendation.recommendationKey }, create: { ...recommendation, limitations: json(recommendation.limitations), dataSnapshot: json(recommendation.dataSnapshot) }, update: {} }));
      }
      return NextResponse.json({ generated: created.length, recommendations: created, insufficientData: candidates.length === 0, note: "Somente métricas observadas em janela 7D; sem recomendação quando cada lado não tem ao menos quatro posts comparáveis. Nenhuma mudança editorial foi aplicada." });
    }
    if (body.action === "refresh-experiments") {
      const experiments = await prisma.editorialExperiment.findMany({
        include: { posts: { include: { post: { select: { publishedAt: true, metrics: {
          where: { availability: { in: ["AVAILABLE", "PARTIAL"] } }, orderBy: { capturedAt: "desc" }, take: 20,
          select: { measurementWindow: true, capturedAt: true, source: true, availability: true, impressions: true, membersReached: true, reactions: true, comments: true, shares: true, postSaves: true, profileViewsFromContent: true, outOfNetworkPercent: true, interactionRate: true },
        } } } } } },
      });
      let evaluationsSaved = 0;
      for (const experiment of experiments) {
        const criteriaJson = isRecord(experiment.comparisonCriteria) ? experiment.comparisonCriteria : {};
        const metric: EditorialMetric = EDITORIAL_METRICS.includes(experiment.primaryMetric as EditorialMetric) ? experiment.primaryMetric as EditorialMetric : "impressions";
        const window = ["24H", "72H", "7D", "LIFETIME"].includes(String(criteriaJson.measurementWindow)) ? String(criteriaJson.measurementWindow) as ExposureWindow : "7D";
        const observations: ExperimentObservation[] = experiment.posts.flatMap((link) => link.post.metrics.map((m) => ({
          postId: link.postId, armLabel: link.armLabel, publishedAt: link.post.publishedAt, language: "", formatType: "", pillar: "", topic: null,
          measurementWindow: m.measurementWindow, capturedAt: m.capturedAt, source: m.source, availability: m.availability,
          impressions: m.impressions, membersReached: m.membersReached, reactions: m.reactions, comments: m.comments, shares: m.shares,
          postSaves: m.postSaves, profileViewsFromContent: m.profileViewsFromContent, outOfNetworkPercent: m.outOfNetworkPercent, interactionRate: m.interactionRate,
        })));
        const analysis = summarizeExperiment({ observations, metric, window, minimumObservations: experiment.minimumObservations, startsAt: experiment.periodStart, endsAt: experiment.periodEnd });
        const secondaryAnalyses = (Array.isArray(experiment.secondaryMetrics) ? experiment.secondaryMetrics : []).filter((value): value is EditorialMetric => typeof value === "string" && EDITORIAL_METRICS.includes(value as EditorialMetric)).map((secondaryMetric) => summarizeExperiment({ observations, metric: secondaryMetric, window, minimumObservations: experiment.minimumObservations, startsAt: experiment.periodStart, endsAt: experiment.periodEnd }));
        const completeResults = { primary: analysis, secondary: secondaryAnalyses };
        const fingerprint = createHash("sha256").update(JSON.stringify({ metric, window, groups: analysis.coverage, secondary: secondaryAnalyses.map((item) => item.coverage), posts: observations.filter((item) => item.measurementWindow === window).map((item) => [item.postId, item.capturedAt, item[metric]]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) })).digest("hex");
        const saved = await prisma.editorialExperimentEvaluation.createMany({ data: [{ experimentId: experiment.id, measurementWindow: window, metric, dataFingerprint: fingerprint, results: json(completeResults) }], skipDuplicates: true });
        evaluationsSaved += saved.count;
        if (experiment.status !== EditorialExperimentStatus.COMPLETED && experiment.status !== EditorialExperimentStatus.CANCELLED) {
          await prisma.editorialExperiment.update({ where: { id: experiment.id }, data: { status: analysis.status, results: json(completeResults), limitations: json(analysis.limitations) } });
        }
      }
      return NextResponse.json({ evaluated: experiments.length, newEvaluationSnapshots: evaluationsSaved, note: "Idempotente por fingerprint dos snapshots observados; avaliações anteriores são preservadas." });
    }
    return jsonError("Ação não reconhecida.");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return jsonError("Registro duplicado; a operação idempotente preservou o original.", 409);
    console.error("[experimentation] write failed", error instanceof Error ? error.name : "unknown");
    return jsonError("Não foi possível salvar a alteração.", 500);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonError("JSON inválido."); }
  if (body.resource === "experiment" && typeof body.id === "string") {
    if (body.status !== "COMPLETED" && body.status !== "CANCELLED") return jsonError("Só é permitido concluir ou cancelar o experimento manualmente.");
    try {
      const experiment = await prisma.editorialExperiment.findUnique({ where: { id: body.id }, select: { id: true, status: true } });
      if (!experiment) return jsonError("Experimento não encontrado.", 404);
      if (experiment.status === "COMPLETED" || experiment.status === "CANCELLED") return jsonError("O experimento já está em estado final.", 409);
      if (body.status === "COMPLETED" && experiment.status !== "READY_FOR_REVIEW") return jsonError("Só conclua após a amostra mínima e revisão dos resultados.", 409);
      const updated = await prisma.editorialExperiment.update({ where: { id: body.id }, data: { status: body.status, recommendation: cleanText(body.recommendation, 1_000) ?? undefined } });
      return NextResponse.json({ experiment: updated });
    } catch (error) {
      console.error("[experimentation] experiment decision failed", error instanceof Error ? error.name : "unknown");
      return jsonError("Não foi possível registrar o estado do experimento.", 500);
    }
  }
  if (body.resource !== "recommendation" || typeof body.id !== "string") return jsonError("Recurso inválido.");
  const allowed = ["APPROVED", "REJECTED", "DEFERRED", "APPLIED"] as const;
  if (!allowed.includes(body.status as typeof allowed[number])) return jsonError("Estado de recomendação inválido.");
  if (body.status === "APPLIED" && !cleanText(body.decisionNote, 1_000)) return jsonError("Registre a ação manual realizada antes de marcar como aplicada.");
  try {
    const current = await prisma.editorialRecommendation.findUnique({ where: { id: body.id }, select: { id: true, status: true } });
    if (!current) return jsonError("Recomendação não encontrada.", 404);
    if (current.status === "APPLIED" || current.status === "REJECTED") return jsonError("Uma decisão final não pode ser sobrescrita.", 409);
    const recommendation = await prisma.editorialRecommendation.update({ where: { id: body.id }, data: { status: body.status as "APPROVED" | "REJECTED" | "DEFERRED" | "APPLIED", decisionNote: cleanText(body.decisionNote, 1_000), decidedAt: new Date() } });
    return NextResponse.json({ recommendation });
  } catch (error) {
    console.error("[experimentation] recommendation decision failed", error instanceof Error ? error.name : "unknown");
    return jsonError("Não foi possível registrar a decisão.", 500);
  }
}
