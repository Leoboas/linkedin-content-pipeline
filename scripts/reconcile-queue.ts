import { readFile } from "node:fs/promises";
import { reconcileOverduePosts } from "../src/lib/scheduler.ts";

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

const { PrismaClient } = await import("@prisma/client");
const { prisma } = await import("../src/lib/prisma.ts");
void PrismaClient;
try {
  const result = await reconcileOverduePosts();
  console.log(JSON.stringify({
    inspected: result.inspected,
    rescheduled: result.rescheduled,
    posts: result.posts.map((post) => ({ id: post.id, pillar: post.pillar, from: post.from, to: post.to })),
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
