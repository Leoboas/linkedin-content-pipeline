import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

type EnvMap = Record<string, string>;

function parseEnvFile(filePath: string): EnvMap {
  if (!existsSync(filePath)) return {};
  const values: EnvMap = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, "$2");
  }
  return values;
}

function targetFingerprint(connectionString: string): string {
  const url = new URL(connectionString);
  const identity = [url.protocol, url.hostname.toLowerCase(), url.port || "5432", url.pathname, decodeURIComponent(url.username)].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

/**
 * Prisma CLI can load .env, but does not make .env.local an authoritative source.
 * All guarded write commands use only the explicitly named .env.development.local.
 */
export function loadConfirmedDevelopmentDatabase(root = process.cwd()): { fingerprint: string; provider: "neon" | "supabase"; target: string } {
  const devEnv = parseEnvFile(resolve(root, ".env.development.local"));
  const provider = (devEnv.DB_PROVIDER || "neon").toLowerCase();
  const required = provider === "supabase"
    ? ["POSTGRES_PRISMA_URL", "DB_ENVIRONMENT", "DB_TARGET_CONFIRMED", "SUPABASE_PROJECT_REF", "DB_EXPECTED_SUPABASE_PROJECT_REF", "DB_EXPECTED_FINGERPRINT"]
    : ["POSTGRES_PRISMA_URL", "DB_ENVIRONMENT", "DB_TARGET_CONFIRMED", "NEON_PROJECT_ID", "NEON_BRANCH_ID", "DB_PRODUCTION_BRANCH_ID", "DB_EXPECTED_NEON_PROJECT_ID", "DB_EXPECTED_NEON_BRANCH_ID", "DB_EXPECTED_FINGERPRINT"];
  const missing = required.filter((key) => !devEnv[key]);
  if (missing.length) throw new Error(`Banco de desenvolvimento não configurado. Preencha .env.development.local: ${missing.join(", ")}. Nenhuma conexão foi aberta.`);
  if (provider !== "neon" && provider !== "supabase") throw new Error("DB_PROVIDER deve ser neon ou supabase. Nenhuma conexão foi aberta.");
  if (devEnv.DB_ENVIRONMENT !== "development" || devEnv.DB_TARGET_CONFIRMED !== "true") {
    throw new Error("Operação bloqueada: confirme DB_ENVIRONMENT=development e DB_TARGET_CONFIRMED=true na configuração isolada.");
  }

  const connectionString = devEnv.POSTGRES_PRISMA_URL;
  const parsed = new URL(connectionString);
  let target: string;
  if (provider === "neon") {
    if (devEnv.NEON_PROJECT_ID !== devEnv.DB_EXPECTED_NEON_PROJECT_ID || devEnv.NEON_BRANCH_ID !== devEnv.DB_EXPECTED_NEON_BRANCH_ID) {
      throw new Error("Operação bloqueada: os IDs confirmados do projeto/branch Neon não correspondem aos IDs esperados.");
    }
    if (devEnv.NEON_BRANCH_ID === devEnv.DB_PRODUCTION_BRANCH_ID) throw new Error("Operação bloqueada: o branch configurado como Development é o mesmo branch informado como Production.");
    if (!parsed.hostname.toLowerCase().endsWith(".neon.tech")) throw new Error("Operação bloqueada: a conexão de desenvolvimento não aponta para um host Neon reconhecido.");
    target = `${devEnv.NEON_PROJECT_ID}/${devEnv.NEON_BRANCH_ID}`;
  } else {
    const projectRef = devEnv.SUPABASE_PROJECT_REF;
    if (projectRef !== devEnv.DB_EXPECTED_SUPABASE_PROJECT_REF) throw new Error("Operação bloqueada: o project ref do Supabase não corresponde ao valor esperado.");
    const hostname = parsed.hostname.toLowerCase();
    const directHost = hostname === `db.${projectRef.toLowerCase()}.supabase.co`;
    const sessionPooler = hostname.endsWith(".pooler.supabase.com") && parsed.port === "5432" && decodeURIComponent(parsed.username).endsWith(`.${projectRef}`);
    if (!directHost && !sessionPooler) throw new Error("Operação bloqueada: use a conexão direta do projeto Supabase ou o Session Pooler (porta 5432), com o project ref confirmado.");
    if (parsed.port && parsed.port !== "5432") throw new Error("Operação bloqueada: migrations não podem usar o Transaction Pooler; use conexão direta ou Session Pooler na porta 5432.");
    if (parsed.searchParams.get("pgbouncer") === "true") throw new Error("Operação bloqueada: pgbouncer=true indica conexão transacional não permitida para migrations.");
    if (!parsed.pathname || parsed.pathname === "/") throw new Error("Operação bloqueada: informe o nome do banco Supabase na URL.");
    target = `${projectRef}/${decodeURIComponent(parsed.pathname.slice(1))}`;
  }
  const fingerprint = targetFingerprint(connectionString);
  if (fingerprint !== devEnv.DB_EXPECTED_FINGERPRINT) {
    throw new Error(`Operação bloqueada: fingerprint do banco diverge. Fingerprint observado: ${fingerprint}. Confira projeto, branch, database e usuário antes de confirmar.`);
  }

  for (const fileName of [".env", ".env.local"]) {
    const existing = parseEnvFile(resolve(root, fileName)).POSTGRES_PRISMA_URL;
    if (existing) {
      try {
        if (targetFingerprint(existing) === fingerprint) throw new Error(`Operação bloqueada: o alvo development coincide com o POSTGRES_PRISMA_URL de ${fileName}.`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Operação bloqueada:")) throw error;
        // Malformed unrelated local values do not become a write target; Prisma is not run against them.
      }
    }
  }

  // Override any inherited shell value so the child Prisma process uses exactly this verified target.
  process.env.POSTGRES_PRISMA_URL = connectionString;
  process.env.DATABASE_URL = connectionString;
  delete process.env.VERCEL_ENV;
  return { fingerprint, provider, target };
}
