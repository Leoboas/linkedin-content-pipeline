import { readFile } from "node:fs/promises";
import { PostStatus, PrismaClient } from "@prisma/client";

async function loadEnvFile(filePath: string): Promise<void> {
  try {
    const text = await readFile(filePath, "utf8");
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
  const result = await prisma.post.updateMany({
    where: { status: { notIn: [PostStatus.PUBLISHED, PostStatus.CANCELLED] } },
    data: { status: PostStatus.CANCELLED },
  });

  const cancelled = await prisma.post.count({ where: { status: PostStatus.CANCELLED } });
  console.log(`Posts não publicados cancelados: ${result.count}`);
  console.log(`Total de posts cancelados na base: ${cancelled}`);
} finally {
  await prisma.$disconnect();
}
