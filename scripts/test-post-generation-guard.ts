import assert from "node:assert/strict";
import { hasDuplicatePostTitle, weeklyGenerationKeys } from "../src/lib/post-generation-guard.ts";
import { formatDateTimeLocalInBrazil } from "../src/lib/dates.ts";
import { scheduledDateForPost } from "../src/lib/scheduling.ts";

assert.deepEqual(weeklyGenerationKeys("2026-11-23", 3), [
  "weekly:2026-11-23:slot:0",
  "weekly:2026-11-23:slot:1",
  "weekly:2026-11-23:slot:2",
]);
assert.equal(weeklyGenerationKeys("2026-11-23", 99).length, 4);
assert.equal(hasDuplicatePostTitle("Engenharia de dados reduz decisões invisíveis", ["Engenharia de Dados Reduz Decisões Invisíveis"]), true);
assert.equal(hasDuplicatePostTitle("Como projetar retries idempotentes em APIs", ["Como projetar retries idempotentes em API"]), true);
assert.equal(hasDuplicatePostTitle("Isolamento por tenant no PostgreSQL", ["Observabilidade de pipelines com Airflow"]), false);
assert.equal(hasDuplicatePostTitle("", ["Qualquer post de tecnologia"]), false);
const monday = new Date("2026-11-23T03:00:00.000Z");
assert.equal(formatDateTimeLocalInBrazil(scheduledDateForPost(0, "TOFU", monday)), "2026-11-23T08:30");
assert.equal(formatDateTimeLocalInBrazil(scheduledDateForPost(1, "MOFU", monday)), "2026-11-25T11:45");
assert.equal(formatDateTimeLocalInBrazil(scheduledDateForPost(2, "BOFU", monday)), "2026-11-27T09:15");

console.log("Generation guard tests passed (stable slots and duplicate-title prevention).");
