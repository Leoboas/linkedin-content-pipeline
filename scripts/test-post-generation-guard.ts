import assert from "node:assert/strict";
import { getAvailableWeeklySlots, hasDuplicatePostTitle, weeklyGenerationKeys } from "../src/lib/post-generation-guard.ts";
import { formatDateTimeLocalInBrazil } from "../src/lib/dates.ts";
import { scheduledDateForPost } from "../src/lib/scheduling.ts";

assert.deepEqual(weeklyGenerationKeys("2026-11-23", 3), [
  "weekly:2026-11-23:slot:0",
  "weekly:2026-11-23:slot:1",
  "weekly:2026-11-23:slot:2",
]);
assert.equal(weeklyGenerationKeys("2026-11-23", 99).length, 4);
const failedWeekSlots = weeklyGenerationKeys("2026-11-23", 4).map((generationKey) => ({
  generationKey,
  status: "DRAFT",
  qualityStatus: "NEEDS_REVISION",
}));
assert.deepEqual(getAvailableWeeklySlots("2026-11-23", 4, failedWeekSlots).map((slot) => slot.generationKey), [
  "weekly:2026-11-23:slot:0:revision:2",
  "weekly:2026-11-23:slot:1:revision:2",
  "weekly:2026-11-23:slot:2:revision:2",
  "weekly:2026-11-23:slot:3:revision:2",
]);
assert.deepEqual(getAvailableWeeklySlots("2026-11-23", 4, [
  { generationKey: "weekly:2026-11-23:slot:0", status: "AWAITING_APPROVAL", qualityStatus: "PASS" },
]), [
  { slotIndex: 1, generationKey: "weekly:2026-11-23:slot:1" },
  { slotIndex: 2, generationKey: "weekly:2026-11-23:slot:2" },
  { slotIndex: 3, generationKey: "weekly:2026-11-23:slot:3" },
]);
assert.deepEqual(getAvailableWeeklySlots("2026-11-23", 1, [
  { generationKey: "weekly:2026-11-23:slot:0", status: "DRAFT", qualityStatus: "PASS" },
]), [], "a passing draft remains claimed and cannot be duplicated");
assert.deepEqual(getAvailableWeeklySlots("2026-11-23", 1, [
  { generationKey: "weekly:2026-11-23:slot:0", status: "DRAFT", qualityStatus: "NEEDS_REVISION" },
  { generationKey: "weekly:2026-11-23:slot:0:revision:2", status: "DRAFT", qualityStatus: "BLOCKED" },
  { generationKey: "weekly:2026-11-23:slot:0:revision:3", status: "DRAFT", qualityStatus: "NEEDS_REVISION" },
]), [], "retries are bounded to two per slot");
assert.deepEqual(getAvailableWeeklySlots("2026-11-23", 1, [
  { generationKey: "weekly:2026-11-23:slot:0", status: "ARCHIVED", qualityStatus: "PASS" },
]), [{ slotIndex: 0, generationKey: "weekly:2026-11-23:slot:0:revision:2" }]);
assert.equal(hasDuplicatePostTitle("Engenharia de dados reduz decisões invisíveis", ["Engenharia de Dados Reduz Decisões Invisíveis"]), true);
assert.equal(hasDuplicatePostTitle("Como projetar retries idempotentes em APIs", ["Como projetar retries idempotentes em API"]), true);
assert.equal(hasDuplicatePostTitle("Isolamento por tenant no PostgreSQL", ["Observabilidade de pipelines com Airflow"]), false);
assert.equal(hasDuplicatePostTitle("", ["Qualquer post de tecnologia"]), false);
const monday = new Date("2026-11-23T03:00:00.000Z");
assert.equal(formatDateTimeLocalInBrazil(scheduledDateForPost(0, "TOFU", monday)), "2026-11-23T13:00");
assert.equal(formatDateTimeLocalInBrazil(scheduledDateForPost(1, "MOFU", monday)), "2026-11-24T16:00");
assert.equal(formatDateTimeLocalInBrazil(scheduledDateForPost(2, "BOFU", monday)), "2026-11-26T13:00");

console.log("Generation guard tests passed (retryable failed slots, bounded revisions, date cadence and duplicate-title prevention).");
