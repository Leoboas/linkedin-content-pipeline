import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRecommendationCandidate, buildWeeklyEditorialTimeline, cyclePhase, summarizeExperiment, validateFixedEditorialDistribution, validateOutcomeAssociation, type ExperimentObservation } from "../src/lib/editorial-experimentation";

function observation(overrides: Partial<ExperimentObservation> & Pick<ExperimentObservation, "postId" | "armLabel">): ExperimentObservation {
  return {
    publishedAt: "2026-10-01T12:00:00.000Z", language: "en-US", formatType: "SINGLE_IMAGE", pillar: "MOFU", topic: "data-platforms",
    measurementWindow: "7D", capturedAt: "2026-10-08T12:00:00.000Z", source: "MANUAL", availability: "AVAILABLE",
    impressions: 100, membersReached: 80, reactions: 8, comments: 2, shares: 1, postSaves: 1,
    profileViewsFromContent: 3, outOfNetworkPercent: 40, interactionRate: 11,
    ...overrides,
  };
}

const testNow = new Date("2026-11-21T12:00:00.000Z");
const base = { metric: "impressions" as const, window: "7D" as const, minimumObservations: 2, startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-12-01T00:00:00Z"), now: testNow };

const noData = summarizeExperiment({ ...base, observations: [observation({ postId: "null", armLabel: "A", impressions: null })] });
assert.equal(noData.sampleSize, 0, "NULL metric must remain missing, not become zero");
assert.equal(noData.status, "RUNNING");

const measuredZero = summarizeExperiment({ ...base, observations: [observation({ postId: "zero", armLabel: "A", impressions: 0 })] });
assert.equal(measuredZero.sampleSize, 1, "measured zero remains a valid observation");

const insufficient = summarizeExperiment({ ...base, minimumObservations: 2, endsAt: new Date("2026-11-20T00:00:00Z"), observations: [
  observation({ postId: "a1", armLabel: "A", impressions: 100 }), observation({ postId: "b1", armLabel: "B", impressions: 50 }),
] });
assert.equal(insufficient.status, "INSUFFICIENT_DATA");
assert.equal(insufficient.comparison, null, "one observation per arm is not reported as a comparison");

const comparable = summarizeExperiment({ ...base, minimumObservations: 2, observations: [
  observation({ postId: "a1", armLabel: "A", impressions: 100 }), observation({ postId: "a1", armLabel: "A", impressions: 150, capturedAt: "2026-10-09T12:00:00Z" }),
  observation({ postId: "a2", armLabel: "A", impressions: 200 }), observation({ postId: "b1", armLabel: "B", impressions: 80 }), observation({ postId: "b2", armLabel: "B", impressions: 100 }),
  observation({ postId: "excluded-window", armLabel: "B", measurementWindow: "24H", impressions: 999 }),
] });
assert.equal(comparable.sampleSize, 4, "one latest snapshot per post and exact window only");
assert.equal(comparable.coverage.find((arm) => arm.label === "A")?.mean, 175);
assert.deepEqual(comparable.coverage.find((arm) => arm.label === "A")?.sources, ["MANUAL"]);
assert.equal(comparable.comparison?.highestObservedArm, "A");
assert.match(comparable.comparison?.note ?? "", /não demonstra causalidade/);

const rec = buildRecommendationCandidate({ dimension: "format", value: "CAROUSEL_PDF", metric: "interactionRate", window: "7D", periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-11-01"), selected: { n: 6, mean: 12, postIds: ["p1", "p2"] }, comparison: { n: 6, mean: 8, postIds: ["p3", "p4"] }, sources: ["LINKEDIN_API", "MANUAL"] });
assert.equal(rec.confidence, "MEDIUM");
assert.match(rec.justification, /Associação descritiva/);
assert.deepEqual((rec.dataSnapshot as { selected: { postIds: string[] }; sources: string[] }).selected.postIds, ["p1", "p2"]);
assert.deepEqual((rec.dataSnapshot as { sources: string[] }).sources, ["LINKEDIN_API", "MANUAL"]);
assert.match(rec.nextAction, /frequência/);

assert.equal(cyclePhase(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-20T00:00:00Z")), "BASELINE");
assert.equal(cyclePhase(new Date("2026-08-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z")), "COMPLETE");
const outsidePeriod = summarizeExperiment({ ...base, startsAt: new Date("2026-11-01T00:00:00Z"), observations: [observation({ postId: "old", armLabel: "A", impressions: 42 })] });
assert.equal(outsidePeriod.sampleSize, 0, "posts outside the experiment period are excluded");
assert.equal(validateFixedEditorialDistribution(4, { "en-US": 2, "pt-BR": 2 }), true);
assert.equal(validateFixedEditorialDistribution(4, { "en-US": 3, "pt-BR": 1 }), false, "cycle setup must not silently change approved language mix");
assert.equal(validateOutcomeAssociation({ origin: "UNKNOWN", association: "UNLINKED", postId: null, networkingActivityId: null, evidenceNote: null }), null);
assert.ok(validateOutcomeAssociation({ origin: "POST_CONFIRMED", association: "CONFIRMED", postId: null, networkingActivityId: null, evidenceNote: "" }));
assert.equal(validateOutcomeAssociation({ origin: "POST_CONFIRMED", association: "CONFIRMED", postId: "published-post", networkingActivityId: null, evidenceNote: "Recruiter mencionou a publicação." }), null);
assert.ok(validateOutcomeAssociation({ origin: "UNKNOWN", association: "HYPOTHESIS", postId: null, networkingActivityId: null, evidenceNote: null }));
const timeline = buildWeeklyEditorialTimeline({
  posts: [
    { postId: "p1", publishedAt: "2026-11-16T16:00:00-03:00", impressions: 100, membersReached: 70, profileViewsFromContent: null, outOfNetworkPercent: null, window: "7D" },
    { postId: "p2", publishedAt: "2026-11-18T16:00:00-03:00", impressions: 200, membersReached: 80, profileViewsFromContent: 4, outOfNetworkPercent: 20, window: "7D" },
  ],
  activities: [{ occurredAt: "2026-11-19T15:00:00-03:00", type: "COMMENT_PUBLISHED", publicationConfirmed: true, newRelevantConnection: false, conversationStarted: false }],
  outcomes: [{ occurredAt: "2026-11-20T11:00:00-03:00", type: "RECRUITER_CONTACT", origin: "UNKNOWN", association: "UNLINKED" }],
});
assert.equal(timeline.length, 1, "BRT calendar grouping should preserve the shared week");
assert.equal(timeline[0]?.averageImpressionsPerPost, 150);
assert.equal(timeline[0]?.averageReachPerPost, 75, "reach is averaged per post, not summed as unique people");
assert.equal(timeline[0]?.averageProfileViewsFromPost, 4, "missing values do not become zero");
assert.equal(timeline[0]?.manuallyConfirmedComments, 1);
assert.equal(timeline[0]?.recruiterContacts, 1);
const migration = readFileSync(resolve(process.cwd(), "prisma/migrations/20261122160000_experimental_editorial_career_outcomes/migration.sql"), "utf8");
assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE FROM)\b/iu, "Phase 4 migration must remain additive");
for (const table of ["EditorialLearningCycle", "EditorialExperiment", "EditorialExperimentEvaluation", "EditorialRecommendation", "QualifiedAudienceCriteria", "CareerOutcome"]) assert.match(migration, new RegExp(`CREATE TABLE "${table}"`, "u"));
assert.match(migration, /CareerOutcome_postId_fkey/u);
assert.match(migration, /EditorialExperimentPost_postId_fkey/u);
console.log("Editorial experimentation checks passed (NULL vs zero, comparable windows, dedupe, insufficient sample, observational language, and 90-day phases).");
