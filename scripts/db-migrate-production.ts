import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertProductionMigrationAcknowledgements, productionExpectedAppliedMigrations, productionExpectedPendingMigrations } from "./lib/production-migration-guard.ts";

const root = process.cwd();
const expectedHost = "ep-rapid-smoke-acgsved1.sa-east-1.aws.neon.tech";
const expectedProjectId = "dark-poetry-32873331";
const expectedDatabase = "neondb";
const knownFailedMigration = "20261119130000_exact_editorial_language_counts";

function parseEnvFile(fileName: string): Record<string, string> {
  const filePath = resolve(root, fileName);
  if (!existsSync(filePath)) throw new Error(`Arquivo ${fileName} ausente; execução bloqueada.`);
  const entries: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);
    if (!match) continue;
    entries[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, "$2");
  }
  return entries;
}

function parseConnection(value: string) {
  const url = new URL(value);
  return {
    url,
    identity: [url.protocol, url.hostname.toLowerCase(), url.port || "5432", url.pathname, url.username].join("|"),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shouldApply = args.includes("--apply");
  const inspectOnly = args.includes("--inspect-only");
  if (shouldApply && inspectOnly) throw new Error("Use --inspect-only ou --apply, não ambos.");
  const recoveryAcknowledgement = assertProductionMigrationAcknowledgements(args, { applying: shouldApply });
  const local = parseEnvFile(".env.local");
  const env = parseEnvFile(".env");
  const localUrl = local.POSTGRES_URL_NON_POOLING ?? local.DATABASE_URL_UNPOOLED;
  const envUrl = env.POSTGRES_URL_NON_POOLING ?? env.DATABASE_URL_UNPOOLED;
  if (!localUrl || !envUrl) throw new Error("Uma URL Neon direta (POSTGRES_URL_NON_POOLING ou DATABASE_URL_UNPOOLED) deve existir nos dois arquivos locais.");

  const localTarget = parseConnection(localUrl);
  const envTarget = parseConnection(envUrl);
  if (localTarget.identity !== envTarget.identity || localTarget.url.password !== envTarget.url.password) {
    throw new Error(".env e .env.local apontam para alvos diferentes; nenhuma conexão foi aberta.");
  }
  if (localTarget.url.hostname !== expectedHost || localTarget.url.pathname !== `/${expectedDatabase}` || localTarget.url.username !== "neondb_owner") {
    throw new Error("A URL direta não corresponde exatamente ao endpoint autorizado de Production pipeline-db/main.");
  }
  for (const [fileName, values] of [[".env.local", local], [".env", env]] as const) {
    const pooledUrl = values.POSTGRES_PRISMA_URL ?? values.DATABASE_URL;
    if (!pooledUrl) throw new Error(`${fileName} deve conter POSTGRES_PRISMA_URL ou DATABASE_URL para validar o endpoint pooler.`);
    const pooled = parseConnection(pooledUrl);
    const pooledHostWithoutSuffix = pooled.url.hostname.replace("-pooler", "");
    if (pooledHostWithoutSuffix !== localTarget.url.hostname || pooled.url.pathname !== localTarget.url.pathname) {
      throw new Error(`${fileName} pooled e direto não apontam para o mesmo endpoint/database Production.`);
    }
  }
  const projectIds = [local.NEON_PROJECT_ID, env.NEON_PROJECT_ID].filter(Boolean);
  if (projectIds.some((id) => id !== expectedProjectId)) {
    throw new Error("NEON_PROJECT_ID diverge do projeto Production confirmado.");
  }

  // Prisma migrate and the preflight both require Neon direct connections, not PgBouncer.
  process.env.POSTGRES_PRISMA_URL = localUrl;
  process.env.DATABASE_URL = localUrl;
  const prisma = new PrismaClient();
  try {
    const [dbIdentity] = await prisma.$queryRaw<Array<{ database_name: string; schema_name: string }>>`
      SELECT current_database() AS database_name, current_schema() AS schema_name
    `;
    if (dbIdentity?.database_name !== expectedDatabase || dbIdentity?.schema_name !== "public") {
      throw new Error("A conexão SQL não corresponde ao banco/schema Production esperado.");
    }

    const applied = await prisma.$queryRaw<Array<{
      migration_name: string;
      checksum: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
      logs: string | null;
    }>>`
      SELECT migration_name, checksum, finished_at, rolled_back_at, logs
      FROM "_prisma_migrations"
      ORDER BY started_at
    `;
    const [sqlProbe] = await prisma.$queryRaw<Array<{
      object_length_function: string | null;
      object_keys_function: string | null;
      language_check_exists: boolean;
    }>>`
      SELECT
        to_regprocedure('jsonb_object_length(jsonb)')::text AS object_length_function,
        to_regprocedure('jsonb_object_keys(jsonb)')::text AS object_keys_function,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'EditorialLine_languageDistribution_count_check'
        ) AS language_check_exists
    `;
    const [languageAudit] = await prisma.$queryRaw<Array<{ invalid_rows: bigint }>>`
      SELECT count(*)::bigint AS invalid_rows
      FROM "EditorialLine"
      WHERE CASE WHEN jsonb_typeof("languageDistribution") = 'object' THEN
        CASE WHEN (SELECT count(*) FROM jsonb_object_keys("languageDistribution") AS keys) = 2
          AND jsonb_typeof("languageDistribution" -> 'pt-BR') = 'number'
          AND jsonb_typeof("languageDistribution" -> 'en-US') = 'number'
        THEN ("languageDistribution" ->> 'pt-BR')::numeric < 0
          OR ("languageDistribution" ->> 'en-US')::numeric < 0
          OR trunc(("languageDistribution" ->> 'pt-BR')::numeric) <> ("languageDistribution" ->> 'pt-BR')::numeric
          OR trunc(("languageDistribution" ->> 'en-US')::numeric) <> ("languageDistribution" ->> 'en-US')::numeric
          OR ("languageDistribution" ->> 'pt-BR')::numeric + ("languageDistribution" ->> 'en-US')::numeric <> "postsPerWeek"
        ELSE TRUE END
      ELSE TRUE END
    `;
    const successful = applied.filter((migration) => migration.finished_at && !migration.rolled_back_at);
    const unfinished = applied.filter((migration) => !migration.finished_at && !migration.rolled_back_at);
    const rolledBack = applied.filter((migration) => migration.rolled_back_at);
    const migrationRoot = resolve(root, "prisma", "migrations");
    const migrationNames = readdirSync(migrationRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(resolve(migrationRoot, name, "migration.sql")))
      .sort();
    const successfulNames = successful.map(({ migration_name }) => migration_name);
    if (unfinished.length) throw new Error("Há migrations pendentes ou interrompidas no histórico; nenhuma escrita será executada.");
    if (rolledBack.some((migration) => migration.migration_name !== knownFailedMigration)) {
      throw new Error("O histórico contém uma migration revertida não reconhecida; operação bloqueada.");
    }
    if (successful.length !== productionExpectedAppliedMigrations.length
      || !productionExpectedAppliedMigrations.every((name, index) => successful[index]?.migration_name === name)) {
      throw new Error("O histórico bem-sucedido de Production diverge das 19 migrations confirmadas; nenhuma migration será executada.");
    }
    if (successful.length > migrationNames.length
      || successful.some((migration, index) => migration.migration_name !== migrationNames[index])) {
      throw new Error("A sequência aplicada não corresponde ao prefixo das migrations versionadas.");
    }
    for (const migration of successful) {
      const sql = readFileSync(resolve(migrationRoot, migration.migration_name, "migration.sql"));
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (checksum !== migration.checksum) throw new Error(`Checksum divergente para ${migration.migration_name}.`);
    }
    const pending = migrationNames.filter((name) => !successfulNames.includes(name));
    const hasExpectedPending = pending.length === productionExpectedPendingMigrations.length
      && productionExpectedPendingMigrations.every((name, index) => pending[index] === name);
    if (pending.length !== 0 && !hasExpectedPending) {
      throw new Error(`A cadeia pendente difere da migration esperada ${productionExpectedPendingMigrations.join(", ")}: ${pending.join(", ") || "nenhuma"}.`);
    }
    for (const name of pending) {
      const sql = readFileSync(resolve(migrationRoot, name, "migration.sql"), "utf8");
      if (/\b(?:DROP|TRUNCATE)\s+(?:TABLE|TYPE|SCHEMA|INDEX|COLUMN)\b|\bDELETE\s+FROM\b/iu.test(sql)) {
        throw new Error(`Migration com operação destrutiva detectada: ${name}.`);
      }
    }

    if (inspectOnly) {
      console.info("Estado de migrations (somente leitura)", applied.map(({ migration_name, finished_at, rolled_back_at, logs }) => ({
        migration: migration_name,
        finished: Boolean(finished_at),
        rolledBack: Boolean(rolled_back_at),
        logs,
      })));
      console.info("Diagnóstico SQL somente leitura", sqlProbe);
      console.info("Cadeia versionada validada", { applied: successfulNames, pending });
      return;
    }
    if (Number(languageAudit.invalid_rows) !== 0) {
      throw new Error(`Language distribution precondition fails for ${languageAudit.invalid_rows} EditorialLine rows; migration blocked.`);
    }

    console.info("Preflight Production aprovado", {
      target: "pipeline-db/main",
      database: dbIdentity.database_name,
      appliedMigrations: successfulNames,
      rolledBackAttempts: rolledBack.length,
      pendingMigrations: pending,
      recoveryAcknowledgement: recoveryAcknowledgement ?? "Não exigido no modo check-only; obrigatório e recente para --apply.",
      mode: shouldApply ? "apply" : "check-only",
    });

    if (!shouldApply) return;
    const prismaCli = resolve(root, "node_modules", "prisma", "build", "index.js");
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
      stdio: "inherit",
      env: process.env,
    });

    const appliedAfter = await prisma.$queryRaw<Array<{
      migration_name: string;
      checksum: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>>`
      SELECT migration_name, checksum, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      ORDER BY started_at
    `;
    const successfulAfter = appliedAfter.filter((migration) => migration.finished_at && !migration.rolled_back_at);
    const unfinishedAfter = appliedAfter.filter((migration) => !migration.finished_at && !migration.rolled_back_at);
    if (successfulAfter.length !== migrationNames.length || unfinishedAfter.length || successfulAfter.some((migration, index) => {
      const expectedChecksum = createHash("sha256")
        .update(readFileSync(resolve(migrationRoot, migrationNames[index], "migration.sql")))
        .digest("hex");
      return migration.migration_name !== migrationNames[index]
        || !migration.finished_at
        || Boolean(migration.rolled_back_at)
        || migration.checksum !== expectedChecksum;
    })) {
      throw new Error("Verificação pós-migration falhou; não execute novas alterações até investigar _prisma_migrations.");
    }
    const schemaDiff = execFileSync(process.execPath, [prismaCli, "migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (schemaDiff && schemaDiff !== "-- This is an empty migration.") {
      throw new Error("As migrations foram registradas, mas ainda há divergência física contra schema.prisma; preserve o log e investigue antes de deploy.");
    }
    console.info("Migrations Production concluídas e histórico validado.", { count: appliedAfter.length });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Migração Production interrompida:", error instanceof Error ? error.message : "erro desconhecido");
  process.exitCode = 1;
});
