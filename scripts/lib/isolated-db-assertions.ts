import type { PrismaClient } from "@prisma/client";

const expectedMonitoredCompany = {
  id: "a4d78d17-4524-4e7b-a8d2-1ba6e3a4c001",
  companyKey: "CODERIO",
  name: "Coderio",
  careersUrl: "https://jobs.lever.co/coderio",
  atsType: "LEVER",
  boardSlug: "coderio",
  priority: 1,
  active: true,
} as const;

const expectedNetworkingTopics = [
  ["00000000-0000-4000-8000-000000000301", "python", "Python", ["python", "cpython", "asyncio"], 10],
  ["00000000-0000-4000-8000-000000000302", "fastapi", "FastAPI", ["fastapi", "pydantic", "asgi"], 20],
  ["00000000-0000-4000-8000-000000000303", "data-engineering", "Data Engineering", ["data engineering", "data engineer", "data platform"], 30],
  ["00000000-0000-4000-8000-000000000304", "sql-postgres", "SQL & PostgreSQL", ["sql", "postgres", "postgresql", "query plan"], 40],
  ["00000000-0000-4000-8000-000000000305", "aws-cloud", "AWS & Cloud Architecture", ["aws", "amazon web services", "cloud architecture"], 50],
  ["00000000-0000-4000-8000-000000000306", "spark-airflow", "PySpark & Airflow", ["pyspark", "spark", "airflow", "orchestration"], 60],
  ["00000000-0000-4000-8000-000000000307", "etl-data-quality", "ETL/ELT & Data Quality", ["etl", "elt", "data quality", "data freshness"], 70],
  ["00000000-0000-4000-8000-000000000308", "distributed-systems", "Distributed Systems", ["distributed systems", "idempotency", "message queue", "event driven"], 80],
  ["00000000-0000-4000-8000-000000000309", "architecture-system-design", "Software Architecture & System Design", ["software architecture", "system design", "clean architecture", "ddd"], 90],
  ["00000000-0000-4000-8000-000000000310", "observability-reliability", "Observability & Reliability", ["observability", "reliability", "sre", "incident response"], 100],
  ["00000000-0000-4000-8000-000000000311", "technical-leadership", "Technical Leadership", ["technical leadership", "engineering manager", "tech lead", "staff engineer"], 110],
] as const;

async function listPublicTables(db: PrismaClient): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  return rows.map((row) => row.table_name);
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`;
}

/** Require empty application tables before applying migrations to a test database. */
export async function assertEmptySchemaForMigration(db: PrismaClient): Promise<void> {
  const tables = await listPublicTables(db);
  const applicationTables = tables.filter((name) => name !== "_prisma_migrations");
  if (applicationTables.length) {
    await assertOnlyDeterministicMigrationSeeds(db, tables);
    await assertEmptyApplicationTables(db, { allowPopulatedTables: ["MonitoredCompany", "NetworkingTopic"] });
    return;
  }
  if (tables.includes("_prisma_migrations")) {
    const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "_prisma_migrations"`;
    if (Number(rows[0]?.count ?? 0) > 0) throw new Error("Migration history exists but the application schema is missing; inspect this isolated database before continuing.");
  }
}

/** Permit only exact seed rows from the already-versioned career/networking migrations. */
export async function assertOnlyDeterministicMigrationSeeds(db: PrismaClient, tables?: readonly string[]): Promise<void> {
  const available = new Set(tables ?? await listPublicTables(db));
  if (available.has("MonitoredCompany")) {
    const rows = await db.$queryRaw<Array<typeof expectedMonitoredCompany>>`
      SELECT id::text AS id, "companyKey", name, "careersUrl", "atsType", "boardSlug", priority, active
      FROM "MonitoredCompany" ORDER BY "companyKey"
    `;
    const exact = rows.length === 1 && Object.keys(expectedMonitoredCompany).every((key) =>
      rows[0]?.[key as keyof typeof expectedMonitoredCompany] === expectedMonitoredCompany[key as keyof typeof expectedMonitoredCompany]);
    if (!exact) throw new Error("Migration guard: MonitoredCompany contém dados além do seed Coderio versionado; nenhuma migration foi executada.");
  }
  if (available.has("NetworkingTopic")) {
    const rows = await db.$queryRaw<Array<{ id: string; key: string; label: string; keywords_json: string; priority: number }>>`
      SELECT id::text AS id, key, label, keywords::text AS keywords_json, priority
      FROM "NetworkingTopic" ORDER BY key
    `;
    const expected = [...expectedNetworkingTopics].sort((a, b) => a[1].localeCompare(b[1])).map(([id, key, label, keywords, priority]) => ({ id, key, label, keywords_json: JSON.stringify(keywords), priority }));
    const actual = rows.map((row) => ({ ...row, keywords_json: JSON.stringify(JSON.parse(row.keywords_json) as unknown) }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("Migration guard: NetworkingTopic contém dados diferentes dos 11 seeds versionados; nenhuma migration foi executada.");
    }
  }
}

/** Refuse synthetic persistence tests if any application table contains data. */
export async function assertEmptyApplicationTables(
  db: PrismaClient,
  options: { allowPopulatedTables?: readonly string[] } = {},
): Promise<void> {
  const allowed = new Set(options.allowPopulatedTables ?? []);
  const tables = (await listPublicTables(db)).filter((name) => name !== "_prisma_migrations" && !allowed.has(name));
  if (!tables.length) throw new Error("The isolated schema has not been migrated yet; apply the versioned migrations before integration tests.");
  const checks = tables.map((name) => {
    const identifier = quoteIdentifier(name);
    const literal = name.replace(/'/gu, "''");
    return `SELECT '${literal}'::text AS table_name WHERE EXISTS (SELECT 1 FROM public.${identifier} LIMIT 1)`;
  });
  const populated = await db.$queryRawUnsafe<Array<{ table_name: string }>>(checks.join(" UNION ALL "));
  if (populated.length) throw new Error(`Synthetic integration test requires empty application tables; data exists in: ${populated.map((row) => row.table_name).slice(0, 12).join(", ")}. No test data was written.`);
}
