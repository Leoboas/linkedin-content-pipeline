import fs from "node:fs";
import path from "node:path";
import { getNeonConnectToken } from "../src/lib/vercel-connect.ts";

function loadLocalEnv(): void {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u);
      if (!match) continue;
      const [, key, rawValue] = match;
      const value = rawValue.replace(/^['"]|['"]$/gu, "");
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

type NeonBranch = { id?: string; name?: string };

async function main(): Promise<void> {
  loadLocalEnv();

  const projectId = process.env.NEON_PROJECT_ID;
  if (!projectId) throw new Error("NEON_PROJECT_ID não está configurado.");

  const branchName = process.env.NEON_BACKUP_BRANCH_NAME ?? "backup-before-phase1-20261116";
  // Localmente, o Connect depende do OIDC do projeto Vercel. Para operações
  // administrativas locais, permita uma Neon API key temporária sem logá-la.
  const token = process.env.NEON_API_KEY ?? await getNeonConnectToken({ type: "app" });
  const endpoint = `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches`;
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const existingResponse = await fetch(endpoint, { headers });
  if (!existingResponse.ok) {
    throw new Error(`Não foi possível consultar branches Neon (HTTP ${existingResponse.status}).`);
  }

  const existing = (await existingResponse.json()) as { branches?: NeonBranch[] };
  const current = existing.branches?.find((branch) => branch.name === branchName);
  if (current) {
    console.log(JSON.stringify({ created: false, branchName, branchId: current.id }, null, 2));
    return;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ branch: { name: branchName, protected: false } }),
  });

  if (!response.ok) {
    const details = (await response.text()).replace(/\s+/gu, " ").slice(0, 500);
    throw new Error(`Não foi possível criar a branch Neon (HTTP ${response.status}): ${details}`);
  }

  const created = (await response.json()) as { branch?: NeonBranch };
  console.log(JSON.stringify({ created: true, branchName, branchId: created.branch?.id }, null, 2));
}

main().catch((error: unknown) => {
  console.error("Falha ao criar branch de backup Neon:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
