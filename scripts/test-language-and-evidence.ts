import assert from "node:assert/strict";
import { normalizeLanguageDistribution, planLanguages } from "../src/lib/language-planner.ts";
import { scoreProjectRelevance } from "../src/lib/editorial-planner.ts";

const distribution = normalizeLanguageDistribution({ "pt-BR": 2, "en-US": 1 }, 3);
assert.deepEqual(distribution, { "pt-BR": 2, "en-US": 1 });
assert.deepEqual(planLanguages(3, distribution).sort(), ["en-US", "pt-BR", "pt-BR"].sort());
assert.equal(planLanguages(0, distribution).length, 0);
assert.deepEqual(normalizeLanguageDistribution({ "pt-BR": 2, "en-US": 2 }, 3), { "pt-BR": 1, "en-US": 2 });
assert.deepEqual(normalizeLanguageDistribution(undefined, 4), { "pt-BR": 2, "en-US": 2 });
assert.equal(planLanguages(4, { "pt-BR": 0, "en-US": 4 }).filter((language) => language === "en-US").length, 4);

const drivesense = { name: "DriveSense", summary: "Connected vehicle telemetry platform with event ingestion and analytics", technologies: ["Python", "FastAPI", "PostgreSQL"] };
const serena = { name: "SerenaERP", summary: "GovTech ERP with multi-tenant procurement workflows", technologies: ["Python", "FastAPI", "PostgreSQL", "Redis"] };
assert.equal(scoreProjectRelevance("How to improve data freshness in a dashboard", drivesense), 0, "Unrelated content must not inherit a portfolio project");
assert.ok(scoreProjectRelevance("SerenaERP multi-tenant FastAPI procurement workflow", serena) >= 3, "Explicit project evidence should match");

console.log("language/evidence acceptance: allocation is consistent and unrelated projects are excluded; no provider calls or database writes.");
