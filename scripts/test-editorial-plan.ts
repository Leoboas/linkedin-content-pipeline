import { strict as assert } from "node:assert";
import { buildEditorialPlanFromContext, isRecentTitleTooSimilar } from "../src/lib/editorial-planner.ts";

const emptyMetric = { value: null as number | null, measuredPosts: 0, totalPosts: 0 };

const plan = buildEditorialPlanFromContext({
  language: "en-US",
  recentPosts: [
    { title: "Retries need an idempotency boundary", topic: "Distributed Systems", editorialObjective: "Authority", language: "en-US", editorialPillar: "MOFU", formatType: "TEXT_ONLY", status: "PUBLISHED" },
    { title: "A retry-safe worker needs idempotency", topic: "Distributed Systems", editorialObjective: "Proof", language: "en-US", editorialPillar: "BOFU", formatType: "SINGLE_IMAGE", status: "PUBLISHED" },
  ],
  performance: {
    generatedAt: "2026-11-21T12:00:00.000Z",
    period: { start: "2026-11-14T12:00:00.000Z", end: "2026-11-21T12:00:00.000Z" },
    totals: {
      impressions: emptyMetric,
      reactions: emptyMetric,
      comments: emptyMetric,
      shares: emptyMetric,
      postSaves: emptyMetric,
      postSends: emptyMetric,
      linkClicks: emptyMetric,
      profileViewsFromContent: emptyMetric,
    },
    postsWithMetrics: 0,
    snapshots: 0,
    coverage: { apiSnapshots: 0, manualSnapshots: 0, legacyExcluded: true },
    comparisonsByExposureWindow: [],
    trends: [],
    hypotheses: [],
    topPostsByObservedInteractionRate: [],
    profileMetrics: [],
    qualifiedOpportunities: [],
    recommendations: ["Manter diversidade editorial."],
    confidence: "muito baixa; amostra pequena",
  },
});

assert.equal(plan.language, "en-US");
assert.match(plan.systemPrompt, /REGRAS DE DIVERSIFICAÇÃO/u);
assert.match(plan.systemPrompt, /Ainda sem snapshots reais suficientes/u);
assert.ok(isRecentTitleTooSimilar("Retries need an idempotency boundary", plan.recentTitles), "O detector deve reconhecer um título já existente.");
assert.equal(plan.recentTitles.length, 2);
console.log(JSON.stringify({ ok: true, language: plan.language, recentTitles: plan.recentTitles.length, databaseAccess: false }, null, 2));
