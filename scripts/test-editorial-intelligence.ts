import assert from "node:assert/strict";
import { FormatType } from "@prisma/client";
import { DEFAULT_WEEKLY_SCHEDULE, isValidWeeklySchedule, normalizeWeeklySchedule } from "../src/lib/editorial-calendar.ts";
import { evaluateHookQuality, classifyEditorialTheme, scoreCareerRelevance, selectEditorialFormat } from "../src/lib/editorial-intelligence.ts";
import { formatDateTimeLocalInBrazil } from "../src/lib/dates.ts";
import { scheduledDateForPost } from "../src/lib/scheduling.ts";

assert.equal(DEFAULT_WEEKLY_SCHEDULE.length, 4);
assert.deepEqual(DEFAULT_WEEKLY_SCHEDULE.map((slot) => slot.language), ["en-US", "pt-BR", "en-US", "pt-BR"]);
assert.deepEqual(DEFAULT_WEEKLY_SCHEDULE.map((slot) => slot.objective), ["Discovery", "Authority", "Proof", "Career Conversion"]);
assert.equal(isValidWeeklySchedule(DEFAULT_WEEKLY_SCHEDULE), true);
assert.equal(isValidWeeklySchedule(DEFAULT_WEEKLY_SCHEDULE.map((slot, index) => index === 0 ? { ...slot, weekday: 3 } : slot)), false);
assert.deepEqual(normalizeWeeklySchedule([{ weekday: 1 }]), DEFAULT_WEEKLY_SCHEDULE);

const week = new Date("2026-11-23T03:00:00.000Z");
const expectedSlots = ["2026-11-23T13:00", "2026-11-24T16:00", "2026-11-26T13:00", "2026-11-27T16:00"];
assert.deepEqual(DEFAULT_WEEKLY_SCHEDULE.map((slot, index) => formatDateTimeLocalInBrazil(scheduledDateForPost(index, "TOFU", week, DEFAULT_WEEKLY_SCHEDULE))), expectedSlots);
const rescheduled = DEFAULT_WEEKLY_SCHEDULE.map((slot, index) => index === 0 ? { ...slot, localTime: "14:15" } : slot);
assert.equal(formatDateTimeLocalInBrazil(scheduledDateForPost(0, "TOFU", week, rescheduled)), "2026-11-23T14:15");

const evidence = [{ id: "project-serena", source: "https://github.com/Leoboas/serenaERP", kind: "PORTFOLIO_PROJECT" as const, claim: "SerenaERP: Python FastAPI PostgreSQL multi-tenant repository constraints", verified: true, claimClassification: "IMPLEMENTATION_DEMONSTRATED" as const }];
const draft = {
  title: "Can a tenant UUID authorize a cross-tenant database write?",
  textContent: "A PostgreSQL foreign key can protect the relationship even when application code makes a mistake. The repository applies tenant scope, and the relational constraint rejects an inconsistent tenant reference. The trade-off is a more specific key design in return for an additional integrity boundary. What other write path needs the same test?",
};
const career = scoreCareerRelevance({ ...draft, evidence });
assert.ok(career.score >= 3 && career.score <= 5);
assert.equal(career.breakdown.evidenceAvailability, 4);
assert.equal(career.scale, "0-5");
const hook = evaluateHookQuality({ ...draft, evidence, recentTitles: ["A PostgreSQL constraint can stop cross-tenant writes"] });
assert.ok(hook.score >= 0 && hook.score <= 100);
assert.equal(hook.scale, "0-100");
assert.equal(classifyEditorialTheme(draft.title, draft.textContent), "Software Architecture");
assert.equal(classifyEditorialTheme("Retries need an idempotency boundary", "A distributed worker must handle duplicate delivery."), "Distributed Systems");

const carousel = selectEditorialFormat({
  requestedFormat: FormatType.CAROUSEL_PDF,
  title: "A write crosses a tenant boundary",
  textContent: "Problem, decision, implementation and validation are explained as a sequence.",
  slides: [
    { title: "01 Problem", bullets: ["The request is authenticated but tenant scope is missing"] },
    { title: "02 Decision", bullets: ["Bind the tenant to identity and repository scope"] },
    { title: "03 Constraint", bullets: ["A composite foreign key rejects cross-tenant references"] },
  ],
});
assert.equal(carousel.formatType, FormatType.CAROUSEL_PDF);
const downgrade = selectEditorialFormat({
  requestedFormat: FormatType.CAROUSEL_PDF,
  title: "A short engineering decision",
  textContent: "A concise argument about a trade-off.",
  slides: ["Same point", "Same point", "Same point"].map((title) => ({ title, bullets: ["Repeated generic content"] })),
});
assert.notEqual(downgrade.formatType, FormatType.CAROUSEL_PDF);
assert.equal(downgrade.visualFormat, "text-first");
assert.notEqual(downgrade.formatType, FormatType.CAROUSEL_PDF);

console.log("Editorial intelligence acceptance: 4 fixed slots/BRT, editable times, 2 EN/2 PT, objective, career relevance, hook quality, theme and contextual format selection passed.");
