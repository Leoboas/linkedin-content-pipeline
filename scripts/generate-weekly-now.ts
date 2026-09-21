import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { Prisma, PostStatus } from "@prisma/client";
import { generateNewPostBatch } from "../src/lib/content-engine.ts";
import { getAppUrl } from "../src/lib/app-url.ts";
import { generateSingleImageAsset } from "../src/lib/creative-renderer.ts";
import type { GeneratedSlide } from "../src/lib/huggingface.ts";
import { prisma } from "../src/lib/prisma.ts";
import { sendBatchToTelegram } from "../src/lib/telegram.ts";
import { uploadPublicAsset } from "../src/lib/storage.ts";
import { formatDateInBrazil } from "../src/lib/dates.ts";

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

function slidesFromJson(value: Prisma.JsonValue | null): GeneratedSlide[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): GeneratedSlide[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, Prisma.JsonValue>;
    if (typeof record.title !== "string" || !Array.isArray(record.bullets)) return [];
    return [{
      title: record.title,
      bullets: record.bullets.filter((bullet): bullet is string => typeof bullet === "string"),
      ...(typeof record.code === "string" ? { code: record.code } : {}),
      ...(Array.isArray(record.metrics) ? { metrics: record.metrics.filter((metric): metric is string => typeof metric === "string") } : {}),
    }];
  });
}

async function renderCarouselPdf(postId: string, title: string, slides: GeneratedSlide[]): Promise<string> {
  if (slides.length === 0) throw new Error(`Post ${postId} não possui lâminas para renderizar.`);
  const pdf = await PDFDocument.create();
  for (const [index, slide] of slides.entries()) {
    const params = new URLSearchParams({
      title: slide.title,
      content: JSON.stringify(slide.bullets),
      page: String(index + 1),
      pageCount: String(slides.length),
      layout: "architecture",
      pillar: "TECH · DATA · GROWTH",
    });
    if (slide.code) params.set("code", slide.code);
    if (slide.metrics) params.set("metrics", JSON.stringify(slide.metrics));
    const response = await fetch(`${getAppUrl()}/api/og/slide?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Falha ao renderizar lâmina ${index + 1}: ${response.status}`);
    const image = await pdf.embedPng(await response.arrayBuffer());
    const page = pdf.addPage([1600, 900]);
    page.drawImage(image, { x: 0, y: 0, width: 1600, height: 900 });
  }
  return uploadPublicAsset(
    `linkedin-posts/${postId}-${encodeURIComponent(title)}.pdf`,
    await pdf.save(),
    "application/pdf",
  );
}

async function main(): Promise<void> {
  await loadEnvFile(".env.local");
  await loadEnvFile(".env");
  const batchKey = `manual-weekly:${new Date().toISOString()}`;
  const postIds = await generateNewPostBatch({ batchKey });
  const posts = await prisma.post.findMany({ where: { id: { in: postIds } } });

  for (const post of posts) {
    if (post.mediaUrl || post.formatType === "TEXT_ONLY") continue;
    const slides = slidesFromJson(post.slidesJson);
    const mediaUrl = post.formatType === "CAROUSEL_PDF"
      ? await renderCarouselPdf(post.id, post.title, slides)
      : await generateSingleImageAsset({
        postId: post.id,
        title: post.title,
        editorialPillar: post.editorialPillar,
        imagePrompt: post.imagePrompt ?? post.title,
      });
    await prisma.post.update({ where: { id: post.id }, data: { mediaUrl } });
  }

  const readyPosts = (await prisma.post.findMany({ where: { id: { in: postIds }, status: PostStatus.AWAITING_APPROVAL } }))
    .sort((left, right) => ["TOFU", "MOFU", "BOFU"].indexOf(left.editorialPillar) - ["TOFU", "MOFU", "BOFU"].indexOf(right.editorialPillar));
  await sendBatchToTelegram(readyPosts);

  console.log("Novo calendário semanal criado e enviado:");
  for (const post of readyPosts) {
    console.log(`${post.editorialPillar} | ${formatDateInBrazil(post.scheduledDate ?? post.scheduledFor)} | ${post.title}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("Falha ao gerar o calendário semanal:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
