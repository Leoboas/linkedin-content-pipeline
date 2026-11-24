import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { assertEmptySchemaForMigration } from "./lib/isolated-db-assertions.ts";
import {
  assertProductionMigrationAcknowledgements,
  productionExpectedAppliedMigrations,
  productionExpectedPendingMigrations,
  productionExpectedPostApplyMigrations,
} from "./lib/production-migration-guard.ts";

const now = new Date("2026-11-24T16:00:00.000Z");
assert.equal(productionExpectedAppliedMigrations.length, 20);
assert.deepEqual(productionExpectedPendingMigrations, ["20261124190000_application_submission_authorization"]);
assert.equal(productionExpectedPostApplyMigrations.length, 21);
assert.equal(assertProductionMigrationAcknowledgements(["--confirm-target=pipeline-db/main"], { applying: false, now }), null);
const freshArgs = ["--confirm-target=pipeline-db/main", "--recovery-reference=pitr:pre-migration", "--recovery-verified-at=2026-11-24T15:45:00.000Z"];
assert.equal(assertProductionMigrationAcknowledgements(freshArgs, { applying: true, now })?.recoveryReference, "pitr:pre-migration");
assert.throws(() => assertProductionMigrationAcknowledgements(["--confirm-target=pipeline-db/main", "--backup-confirmed=2026-11-16"], { applying: true, now }), /recovery-reference/u);
assert.throws(() => assertProductionMigrationAcknowledgements(["--confirm-target=pipeline-db/main", "--recovery-reference=old-branch", "--recovery-verified-at=2026-11-16T00:00:00.000Z"], { applying: true, now }), /30 minutos/u);
assert.throws(() => assertProductionMigrationAcknowledgements(["--recovery-reference=pitr", "--recovery-verified-at=2026-11-24T15:45:00.000Z"], { applying: true, now }), /confirm-target/u);

const company = {
  id: "a4d78d17-4524-4e7b-a8d2-1ba6e3a4c001", companyKey: "CODERIO", name: "Coderio",
  careersUrl: "https://jobs.lever.co/coderio", atsType: "LEVER", boardSlug: "coderio", priority: 1, active: true,
};
const topicRows = [
  ["301", "python", "Python", ["python", "cpython", "asyncio"], 10],
  ["302", "fastapi", "FastAPI", ["fastapi", "pydantic", "asgi"], 20],
  ["303", "data-engineering", "Data Engineering", ["data engineering", "data engineer", "data platform"], 30],
  ["304", "sql-postgres", "SQL & PostgreSQL", ["sql", "postgres", "postgresql", "query plan"], 40],
  ["305", "aws-cloud", "AWS & Cloud Architecture", ["aws", "amazon web services", "cloud architecture"], 50],
  ["306", "spark-airflow", "PySpark & Airflow", ["pyspark", "spark", "airflow", "orchestration"], 60],
  ["307", "etl-data-quality", "ETL/ELT & Data Quality", ["etl", "elt", "data quality", "data freshness"], 70],
  ["308", "distributed-systems", "Distributed Systems", ["distributed systems", "idempotency", "message queue", "event driven"], 80],
  ["309", "architecture-system-design", "Software Architecture & System Design", ["software architecture", "system design", "clean architecture", "ddd"], 90],
  ["310", "observability-reliability", "Observability & Reliability", ["observability", "reliability", "sre", "incident response"], 100],
  ["311", "technical-leadership", "Technical Leadership", ["technical leadership", "engineering manager", "tech lead", "staff engineer"], 110],
].map(([number, key, label, keywords, priority]) => ({
  id: `00000000-0000-4000-8000-000000000${number}`,
  key, label, keywords_json: JSON.stringify(keywords), priority,
}));

function mockDatabase(options: { extraCompany?: boolean; extraTopic?: boolean; extraApplicationRow?: boolean } = {}): PrismaClient {
  const companies = options.extraCompany ? [company, { ...company, id: "unexpected", companyKey: "UNEXPECTED" }] : [company];
  const topics = options.extraTopic ? [...topicRows, { ...topicRows[0], id: "unexpected", key: "unexpected" }] : topicRows;
  return {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("information_schema.tables")) {
        return ["_prisma_migrations", "MonitoredCompany", "NetworkingTopic", "JobApplication"].map((table_name) => ({ table_name }));
      }
      if (sql.includes('FROM "MonitoredCompany"')) return companies;
      if (sql.includes('FROM "NetworkingTopic"')) return [...topics].sort((left, right) => String(left.key).localeCompare(String(right.key)));
      return [];
    },
    $queryRawUnsafe: async () => options.extraApplicationRow ? [{ table_name: "JobApplication" }] : [],
  } as unknown as PrismaClient;
}

async function main(): Promise<void> {
  await assertEmptySchemaForMigration(mockDatabase());
  await assert.rejects(() => assertEmptySchemaForMigration(mockDatabase({ extraCompany: true })), /MonitoredCompany/u);
  await assert.rejects(() => assertEmptySchemaForMigration(mockDatabase({ extraTopic: true })), /NetworkingTopic/u);
  await assert.rejects(() => assertEmptySchemaForMigration(mockDatabase({ extraApplicationRow: true })), /JobApplication/u);
  console.log("Migration guard tests passed: production migration expectations, fresh recovery acknowledgement, exact seeds, and unknown-data rejection.");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
