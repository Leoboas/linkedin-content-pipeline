import { readFile } from "node:fs/promises";
import { PostStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.ts";

async function loadEnv(filePath: string): Promise<void> {
  try {
    const text = await readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([^#=]+)=(.*)$/.exec(line);
      if (match && process.env[match[1].trim()] === undefined) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
}

await loadEnv(".env.local");
await loadEnv(".env");

const posts = await prisma.post.findMany({
  where: { status: { in: [PostStatus.DRAFT, PostStatus.AWAITING_APPROVAL, PostStatus.REGENERATING] } },
  orderBy: { createdAt: "asc" },
  select: { id: true, title: true, editorialPillar: true, scheduledDate: true, createdAt: true },
});

const groups = new Map<string, typeof posts>();
for (const post of posts) {
  const key = `${post.editorialPillar}|${post.scheduledDate?.toISOString() ?? "none"}|${post.title.trim().toLowerCase()}`;
  const group = groups.get(key) ?? [];
  group.push(post);
  groups.set(key, group);
}

let archived = 0;
for (const group of groups.values()) {
  for (const duplicate of group.slice(1)) {
    await prisma.post.update({
      where: { id: duplicate.id },
      data: { status: PostStatus.ARCHIVED, generationKey: null, rejectionFeedback: "Duplicata arquivada automaticamente; o registro original foi preservado." },
    });
    archived += 1;
    console.log(`Arquivado duplicado: ${duplicate.id} | ${duplicate.title}`);
  }
}

console.log(`Duplicatas arquivadas: ${archived}`);
await prisma.$disconnect();
