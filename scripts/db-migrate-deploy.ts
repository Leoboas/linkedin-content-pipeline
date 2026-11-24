import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { loadConfirmedDevelopmentDatabase } from "./lib/confirmed-dev-database.ts";
import { assertEmptySchemaForMigration } from "./lib/isolated-db-assertions.ts";

const target = loadConfirmedDevelopmentDatabase();
console.info("Banco isolado confirmado para migrate deploy", { provider: target.provider, target: target.target });
const prismaCli = resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
const prisma = new PrismaClient();

async function main(): Promise<void> {
  try {
    await assertEmptySchemaForMigration(prisma);
    await prisma.$disconnect();
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", "prisma/schema.prisma"], { stdio: "inherit", env: process.env });
  } finally {
    await prisma.$disconnect();
  }
}

void main();
