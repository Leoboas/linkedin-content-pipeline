import type { PrismaClient } from "@prisma/client";

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
    await assertEmptyApplicationTables(db);
    return;
  }
  if (tables.includes("_prisma_migrations")) {
    const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "_prisma_migrations"`;
    if (Number(rows[0]?.count ?? 0) > 0) throw new Error("Migration history exists but the application schema is missing; inspect this isolated database before continuing.");
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
