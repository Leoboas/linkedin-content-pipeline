import { strict as assert } from "node:assert";
import { isValidProfileMetricValue, metricAvailability, nextDueMeasurementWindow, observedInteractionRate, parseOptionalNonNegativeInteger, snapshotIdempotencyKey } from "../src/lib/analytics-data.ts";
import { buildExploratoryHypotheses, buildPerformanceComparisonGroups, type PerformanceSnapshot } from "../src/lib/analytics-insights-core.ts";
import { parseLinkedInMemberMetricResponse } from "../src/lib/linkedin.ts";
import { classifyLinkedInFailure, getLinkedInDailyBudget } from "../src/lib/linkedin-api-budget.ts";

assert.deepEqual(parseOptionalNonNegativeInteger(""), { valid: true, value: null });
assert.deepEqual(parseOptionalNonNegativeInteger("0"), { valid: true, value: 0 });
assert.equal(parseOptionalNonNegativeInteger("-1").valid, false);
assert.equal(parseOptionalNonNegativeInteger("1.2").valid, false);
assert.equal(isValidProfileMetricValue("IMPRESSIONS_OUTSIDE_NETWORK_PERCENT", 100), true);
assert.equal(isValidProfileMetricValue("IMPRESSIONS_OUTSIDE_NETWORK_PERCENT", 101), false);
assert.equal(isValidProfileMetricValue("IMPRESSIONS_OUTSIDE_NETWORK", 0), true);
assert.equal(observedInteractionRate({ impressions: 100, reactions: null, comments: 0, shares: 0 }), null);
assert.equal(observedInteractionRate({ impressions: 100, reactions: 5, comments: 3, shares: 2 }), 10);
assert.equal(metricAvailability({ impressions: 100, reactions: null }), "PARTIAL");
assert.equal(metricAvailability({ impressions: null }), "UNAVAILABLE");
assert.equal(nextDueMeasurementWindow(30, new Set()), "24H");
assert.equal(nextDueMeasurementWindow(80, new Set(["24H", "72H"])), null);
assert.equal(snapshotIdempotencyKey("p1", "MANUAL", "24H", new Date("2026-11-18T09:00:00Z")), snapshotIdempotencyKey("p1", "MANUAL", "24H", new Date("2026-11-18T19:00:00Z")));
assert.deepEqual(parseLinkedInMemberMetricResponse({ elements: [{ metricType: "IMPRESSION", count: 0 }] }, "IMPRESSION"), { metricType: "IMPRESSION", count: 0 });
assert.deepEqual(parseLinkedInMemberMetricResponse({ elements: [{ metricType: { queryType: "REACTION" }, count: 7 }] }, "REACTION"), { metricType: "REACTION", count: 7 });
assert.deepEqual(parseLinkedInMemberMetricResponse({ elements: [] }, "COMMENT"), { metricType: "COMMENT", count: null });
assert.equal(classifyLinkedInFailure(new Error("LinkedIn 401: unauthorized")), "unauthorized");
assert.equal(classifyLinkedInFailure(new Error("LinkedIn 403: permission denied")), "forbidden");
assert.equal(classifyLinkedInFailure(new Error("LinkedIn 429: rate limited")), "rate_limited");
process.env.LINKEDIN_API_DAILY_BUDGET = "17";
assert.equal(getLinkedInDailyBudget(), 17);
delete process.env.LINKEDIN_API_DAILY_BUDGET;

const fixture = (id: string, pillar: string, rate: number): PerformanceSnapshot => ({
  postId: id,
  measurementWindow: "24H",
  exposureHours: 26,
  impressions: 100,
  membersReached: null,
  reactions: rate,
  comments: 0,
  shares: 0,
  postSaves: null,
  postSends: null,
  linkClicks: null,
  profileViewsFromContent: null,
  engagementScore: null,
  capturedAt: new Date("2026-11-18T12:00:00Z"),
  source: "MANUAL",
  post: { id, title: `Post ${id}`, editorialPillar: pillar, formatType: "SINGLE_IMAGE", language: "pt-BR", topic: "data engineering", publishedAt: new Date("2026-11-17T12:00:00Z"), qualityScore: 90, qualityStatus: "PASS" },
});
const groups = buildPerformanceComparisonGroups([
  fixture("1", "TOFU", 8), fixture("2", "TOFU", 9), fixture("3", "TOFU", 7),
  fixture("4", "BOFU", 2), fixture("5", "BOFU", 3), fixture("6", "BOFU", 1),
]);
const hypotheses = buildExploratoryHypotheses(groups);
assert.ok(hypotheses.some((item) => item.windowAndDimension === "24H:pilar"));
assert.ok(hypotheses.every((item) => item.confidence.includes("exploratória")));
console.log("Analytics fixtures: parser, missing-vs-zero, windows, idempotency and exploratory comparisons OK.");
