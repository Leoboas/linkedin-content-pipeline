import { prisma } from "@/lib/prisma";
import { AdminDashboard, type DashboardPost } from "./AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [posts, references] = await Promise.all([
    prisma.post.findMany({ orderBy: { scheduledFor: "asc" }, take: 200 }),
    prisma.contentReference.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, content: true, sourceUrl: true, createdAt: true },
    }),
  ]);
  const serialized: DashboardPost[] = posts.map((post) => ({
    id: post.id,
    title: post.title,
    textContent: post.textContent,
    imagePrompt: post.imagePrompt,
    mediaUrl: post.mediaUrl,
    editorialPillar: post.editorialPillar,
    status: post.status,
    scheduledFor: post.scheduledFor.toISOString(),
    scheduledDate: (post.scheduledDate ?? post.scheduledFor).toISOString(),
    engagementScore: post.engagementScore,
    engagementLabel: post.engagementLabel,
  }));
  return <AdminDashboard initialPosts={serialized} initialReferences={references.map((reference) => ({
    ...reference,
    createdAt: reference.createdAt.toISOString(),
  }))} />;
}
