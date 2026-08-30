import { prisma } from "@/lib/prisma";
import { AdminDashboard, type DashboardPost } from "./AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const posts = await prisma.post.findMany({ orderBy: { scheduledFor: "asc" }, take: 200 });
  const serialized: DashboardPost[] = posts.map((post) => ({
    id: post.id,
    title: post.title,
    textContent: post.textContent,
    imagePrompt: post.imagePrompt,
    editorialPillar: post.editorialPillar,
    status: post.status,
    scheduledFor: post.scheduledFor.toISOString(),
    scheduledDate: (post.scheduledDate ?? post.scheduledFor).toISOString(),
    engagementScore: post.engagementScore,
    engagementLabel: post.engagementLabel,
  }));
  return <AdminDashboard initialPosts={serialized} />;
}
