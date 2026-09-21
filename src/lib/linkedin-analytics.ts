import { PostStatus } from "@prisma/client";
import { fetchLinkedInMemberPostMetrics } from "@/lib/linkedin";
import { prisma } from "@/lib/prisma";

export async function syncLinkedInPostMetrics(): Promise<{ enabled: boolean; synced: number; skipped: number }> {
  if (process.env.LINKEDIN_POST_ANALYTICS_ENABLED !== "true") return { enabled: false, synced: 0, skipped: 0 };
  const posts = await prisma.post.findMany({
    where: { status: PostStatus.PUBLISHED, linkedinPostId: { not: null } },
    select: { id: true, linkedinPostId: true },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });
  let synced = 0;
  let skipped = 0;
  for (const post of posts) {
    if (!post.linkedinPostId) { skipped += 1; continue; }
    try {
      const metrics = await fetchLinkedInMemberPostMetrics(post.linkedinPostId);
      const values = Object.fromEntries(metrics.map((metric) => [metric.metricType.toUpperCase(), metric.count]));
      const impressions = values.IMPRESSION ?? 0;
      const reactions = values.REACTION ?? 0;
      const comments = values.COMMENT ?? 0;
      const shares = values.RESHARE ?? 0;
      const engagementScore = impressions > 0
        ? Math.min(100, ((reactions * 2 + comments * 5 + shares * 6) / impressions) * 1000)
        : null;
      await prisma.postMetric.create({ data: { postId: post.id, impressions, reactions, comments, shares, engagementScore } });
      await prisma.post.update({ where: { id: post.id }, data: { engagementScore } });
      synced += 1;
    } catch (error) {
      skipped += 1;
      console.warn("[linkedin-analytics] não foi possível sincronizar o post", { postId: post.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { enabled: true, synced, skipped };
}
