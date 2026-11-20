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
const activeQueueStatuses: PostStatus[] = [
  PostStatus.DRAFT,
  PostStatus.PENDING,
  PostStatus.AWAITING_APPROVAL,
  PostStatus.APPROVED,
  PostStatus.SCHEDULED,
  PostStatus.REJECTED_PENDING_FEEDBACK,
  PostStatus.REGENERATING,
];

try {
  const before = await prisma.post.groupBy({ by: ["status"], where: { status: { in: activeQueueStatuses } }, _count: { _all: true } });
  const result = await prisma.post.updateMany({
    where: { status: { in: activeQueueStatuses } },
    data: { status: PostStatus.ARCHIVED, generationKey: null },
  });
  console.log(JSON.stringify({ archived: result.count, before }, null, 2));
} finally {
  await prisma.$disconnect();
}
