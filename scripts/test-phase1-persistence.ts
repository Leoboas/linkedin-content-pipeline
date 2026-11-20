import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeLanguageDistribution, isValidLanguageDistribution, planLanguages } from "../src/lib/language-planner.ts";
import { suggestProjectMatches } from "../src/lib/project-reconciliation.ts";
import { hashPostContent } from "../src/lib/post-versioning.ts";
import { buildContentBrief } from "../src/lib/creative-brief.ts";

assert.deepEqual(normalizeLanguageDistribution({ "pt-BR": 4, "en-US": 0 }, 4), { "pt-BR": 4, "en-US": 0 });
assert.deepEqual(normalizeLanguageDistribution({ "pt-BR": 2, "en-US": 2 }, 4), { "pt-BR": 2, "en-US": 2 }, "a valid explicit multilingual plan is preserved");
assert.equal(isValidLanguageDistribution({ "pt-BR": 2, "en-US": 2 }, 4), true);
assert.equal(isValidLanguageDistribution({ "pt-BR": 2, "en-US": 2 }, 3), false);
assert.deepEqual(planLanguages(4, { "pt-BR": 4, "en-US": 0 }), ["pt-BR", "pt-BR", "pt-BR", "pt-BR"]);
assert.equal(planLanguages(4, { "pt-BR": 1, "en-US": 3 }).filter((language) => language === "en-US").length, 3);

const suggestions = suggestProjectMatches({
  posts: [{ id: "p1", associatedProject: "SerenaERP" }, { id: "p2", associatedProject: "ERP" }, { id: "p3", associatedProject: null }],
  projects: [{ projectKey: "serena-erp", name: "SerenaERP" }],
});
assert.deepEqual(suggestions.map((item) => item.postId), ["p1"], "only exact normalized matches are suggested, never auto-linked");

const snapshot = { title: "Architecture", textContent: "A concrete trade-off", language: "en-US" };
assert.equal(hashPostContent(snapshot), hashPostContent(snapshot));
assert.notEqual(hashPostContent(snapshot), hashPostContent({ ...snapshot, language: "pt-BR" }));

const mixedEvidenceBrief = buildContentBrief({
  title: "Python pipeline observability",
  textContent: "A concrete project example and a documented engineering decision.",
  editorialPillar: "MOFU",
  evidence: [
    { id: "experience-1", source: "professionalExperience:experience-1", kind: "PROFESSIONAL_EXPERIENCE", claim: "Hands-on Python experience.", verified: true },
    { id: "fact-1", source: "professionalFact:fact-1", kind: "CONCEPTUAL_KNOWLEDGE", claim: "Verified architecture fact.", verified: true },
    { id: "project-1", source: "portfolioProject:project-1", kind: "PORTFOLIO_PROJECT", claim: "Implemented project evidence.", verified: true },
    { id: "planned-1", source: "planned", kind: "PLANNED_FEATURE", claim: "Not implemented yet.", verified: true },
  ],
});
assert.deepEqual(mixedEvidenceBrief.evidence.map(({ kind }) => kind), ["PROFESSIONAL_EXPERIENCE", "CONCEPTUAL_KNOWLEDGE", "PORTFOLIO_PROJECT"]);
assert.deepEqual(mixedEvidenceBrief.evidence.map(({ id }) => id), ["experience-1", "fact-1", "project-1"]);

async function main(): Promise<void> {
  const languageMigration = await readFile("prisma/migrations/20261119130000_exact_editorial_language_counts/migration.sql", "utf8");
  assert.match(languageMigration, /RAISE EXCEPTION/u);
  assert.doesNotMatch(languageMigration, /UPDATE\s+"EditorialLine"/iu, "migration must preserve current explicit distribution values");
  const mediaMigration = await readFile("prisma/migrations/20261119120000_persist_creative_evidence_media_approval/migration.sql", "utf8");
  assert.match(mediaMigration, /CreativeBriefEvidence_one_subject_check/u);
  assert.match(mediaMigration, /PostProject_one_primary_per_post_key/u);
  console.log("phase-1 persistence contract tests passed (synthetic data only; no DB connection or writes).");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
