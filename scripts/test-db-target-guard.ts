import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfirmedDevelopmentDatabase } from "./lib/confirmed-dev-database.ts";

function fingerprint(connectionString: string): string {
  const url = new URL(connectionString);
  const identity = [url.protocol, url.hostname.toLowerCase(), url.port || "5432", url.pathname, decodeURIComponent(url.username)].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

function writeEnv(path: string, values: Record<string, string>): void {
  writeFileSync(path, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n"), "utf8");
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "pipelinepost-db-guard-"));
  const prior = {
    POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  try {
    run(root);
  } finally {
    for (const key of Object.keys(prior) as Array<keyof typeof prior>) {
      const value = prior[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

function supabaseConfig(url: string, expectedFingerprint = fingerprint(url)): Record<string, string> {
  return {
    DB_PROVIDER: "supabase",
    DB_ENVIRONMENT: "development",
    DB_TARGET_CONFIRMED: "true",
    SUPABASE_PROJECT_REF: "qa-project-ref",
    DB_EXPECTED_SUPABASE_PROJECT_REF: "qa-project-ref",
    DB_EXPECTED_FINGERPRINT: expectedFingerprint,
    POSTGRES_PRISMA_URL: url,
  };
}

withRoot((root) => {
  const poolerUrl = "postgresql://postgres.qa-project-ref:synthetic-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require";
  writeEnv(join(root, ".env.development.local"), supabaseConfig(poolerUrl));
  process.env.VERCEL_ENV = "production";
  const target = loadConfirmedDevelopmentDatabase(root);
  assert.equal(target.provider, "supabase");
  assert.equal(target.target, "qa-project-ref/postgres");
  assert.equal(process.env.POSTGRES_PRISMA_URL, poolerUrl);
  assert.equal(process.env.DATABASE_URL, poolerUrl);
  assert.equal(process.env.VERCEL_ENV, undefined);
});

withRoot((root) => {
  const wrongProjectUrl = "postgresql://postgres.other-ref:synthetic-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require";
  writeEnv(join(root, ".env.development.local"), supabaseConfig(wrongProjectUrl));
  assert.throws(() => loadConfirmedDevelopmentDatabase(root), /host\/ref Supabase|project ref/i);
});

withRoot((root) => {
  const transactionPoolerUrl = "postgresql://postgres.qa-project-ref:synthetic-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true";
  writeEnv(join(root, ".env.development.local"), supabaseConfig(transactionPoolerUrl));
  assert.throws(() => loadConfirmedDevelopmentDatabase(root), /Transaction Pooler|porta 5432/i);
});

withRoot((root) => {
  const url = "postgresql://postgres.qa-project-ref:synthetic-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require";
  writeEnv(join(root, ".env.development.local"), supabaseConfig(url));
  writeEnv(join(root, ".env.local"), { POSTGRES_PRISMA_URL: url });
  assert.throws(() => loadConfirmedDevelopmentDatabase(root), /coincide com o POSTGRES_PRISMA_URL/);
});

withRoot((root) => {
  const url = "postgresql://tester:synthetic-password@ep-example.neon.tech/testdb?sslmode=require";
  const config = {
    DB_PROVIDER: "neon",
    DB_ENVIRONMENT: "development",
    DB_TARGET_CONFIRMED: "true",
    NEON_PROJECT_ID: "test-project",
    NEON_BRANCH_ID: "br-production",
    DB_PRODUCTION_BRANCH_ID: "br-production",
    DB_EXPECTED_NEON_PROJECT_ID: "test-project",
    DB_EXPECTED_NEON_BRANCH_ID: "br-production",
    DB_EXPECTED_FINGERPRINT: fingerprint(url),
    POSTGRES_PRISMA_URL: url,
  };
  writeEnv(join(root, ".env.development.local"), config);
  assert.throws(() => loadConfirmedDevelopmentDatabase(root), /mesmo branch informado como Production/);
});

console.log("Database target guard tests passed: Supabase session pooler accepted; mismatched project, transaction pooler, production-target collision, and Neon production branch rejected.");
