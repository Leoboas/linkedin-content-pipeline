import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { loadConfirmedDevelopmentDatabase } from "./lib/confirmed-dev-database.ts";

const target = loadConfirmedDevelopmentDatabase();
console.info("Consultando status do histórico no banco isolado", { projectId: target.projectId, branchId: target.branchId, fingerprint: target.fingerprint });
const prismaCli = resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
execFileSync(process.execPath, [prismaCli, "migrate", "status", "--schema", "prisma/schema.prisma"], { stdio: "inherit", env: process.env });
