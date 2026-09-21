import { PostStatus, QualityGateStatus, PrismaClient, type Prisma } from "@prisma/client";
import { reviewPostQuality, qualityReviewJson } from "../src/lib/content-reviewer.ts";

const prisma = new PrismaClient();

function slides(value: Prisma.JsonValue | null): Array<{ title: string; bullets: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, Prisma.JsonValue>;
    if (typeof record.title !== "string" || !Array.isArray(record.bullets)) return [];
    return [{ title: record.title, bullets: record.bullets.filter((bullet): bullet is string => typeof bullet === "string") }];
  });
}

async function main() {
  const posts = await prisma.post.findMany({
    where: { status: { in: [PostStatus.AWAITING_APPROVAL, PostStatus.DRAFT] } },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });
  const summary: Array<Record<string, unknown>> = [];
  for (const post of posts) {
    const review = await reviewPostQuality({ title: post.title, textContent: post.textContent, editorialPillar: post.editorialPillar, slides: slides(post.slidesJson), imagePrompt: post.imagePrompt, mediaUrl: post.mediaUrl });
    const status = review.status === QualityGateStatus.PASS && post.status === PostStatus.AWAITING_APPROVAL ? PostStatus.AWAITING_APPROVAL : PostStatus.DRAFT;
    await prisma.post.update({ where: { id: post.id }, data: { status, qualityScore: review.score, qualityStatus: review.status, qualityReview: qualityReviewJson(review), qualityReviewedAt: new Date() } });
    summary.push({ id: post.id, title: post.title, score: review.score, qualityStatus: review.status, textIssues: review.textIssues, visualIssues: review.visualIssues, recommendations: review.recommendations });
  }
  console.log(JSON.stringify({ reviewed: summary.length, summary }, null, 2));
}

main().catch((error) => { console.error("[quality:review] falha", error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
