import { readFile } from "node:fs/promises";
import { PrismaClient, PostStatus } from "@prisma/client";

async function loadEnvFile(path: string): Promise<void> {
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([^#=]+)=(.*)$/.exec(line);
      if (match && process.env[match[1].trim()] === undefined) {
        process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

await loadEnvFile(".env.local");
await loadEnvFile(".env");

const prisma = new PrismaClient();
try {
  const explicitAll = process.argv.includes("--all");

  const result = await prisma.post.deleteMany({
    where: {
      status: { in: [PostStatus.DRAFT, PostStatus.PENDING, PostStatus.REJECTED, PostStatus.REJECTED_PENDING_FEEDBACK] },
    },
  });
  console.log(`Fila descartável resetada: ${result.count} posts removidos (DRAFT/PENDING/REJECTED/REJECTED_PENDING_FEEDBACK).`);
} finally {
  await prisma.$disconnect();
}
