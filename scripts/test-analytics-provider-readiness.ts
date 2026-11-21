import assert from "node:assert/strict";
import { linkedInOfficialAnalyticsProvider } from "../src/lib/analytics-providers.ts";
import { syncLinkedInPostMetrics } from "../src/lib/linkedin-analytics.ts";

const keys = ["LINKEDIN_ANALYTICS_CRON_ENABLED", "LINKEDIN_API_BUDGET_ENABLED", "LINKEDIN_POST_ANALYTICS_ENABLED", "LINKEDIN_POST_ANALYTICS_PERMISSION_CONFIRMED", "LINKEDIN_PROFILE_ANALYTICS_ENABLED", "LINKEDIN_PROFILE_ANALYTICS_PERMISSION_CONFIRMED", "LINKEDIN_ACCESS_TOKEN"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
async function main(): Promise<void> {
try {
  for (const key of keys) delete process.env[key];
  assert.deepEqual(linkedInOfficialAnalyticsProvider.readiness("post"), { enabled: false, reason: "feature-flag-disabled" });
  process.env.LINKEDIN_POST_ANALYTICS_ENABLED = "true";
  process.env.LINKEDIN_ACCESS_TOKEN = "synthetic-test-token";
  assert.deepEqual(linkedInOfficialAnalyticsProvider.readiness("post"), { enabled: false, reason: "oauth-scope-not-confirmed" });
  process.env.LINKEDIN_POST_ANALYTICS_PERMISSION_CONFIRMED = "true";
  assert.deepEqual(linkedInOfficialAnalyticsProvider.readiness("post"), { enabled: true, reason: null });
  assert.deepEqual(linkedInOfficialAnalyticsProvider.readiness("profile"), { enabled: false, reason: "feature-flag-disabled" });
  process.env.LINKEDIN_ANALYTICS_CRON_ENABLED = "false";
  const result = await syncLinkedInPostMetrics();
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "cron-disabled-until-validated");
} finally {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
}
console.log("Analytics provider readiness passed: automatic reads require feature flags, token presence and separate explicit permission confirmation; cron remains off.");
}

void main();
