import { prisma } from "@/lib/prisma";
import { formatDateTimeLocalInBrazil } from "@/lib/dates";
import { AdminDashboard, type DashboardPost } from "./AdminDashboard";
import { cookies } from "next/headers";
import { DashboardLogin } from "@/app/auth/DashboardLogin";
import { isDashboardSessionValid, DASHBOARD_SESSION_COOKIE } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

function serializeBrazilDate(date: Date): string {
  return `${formatDateTimeLocalInBrazil(date)}:00-03:00`;
}

export default async function AdminPage() {
  const cookieStore = await cookies();
  if (!isDashboardSessionValid(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value)) return <DashboardLogin nextPath="/admin" />;
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
    scheduledFor: serializeBrazilDate(post.scheduledFor),
    scheduledDate: serializeBrazilDate(post.scheduledDate ?? post.scheduledFor),
    engagementScore: post.engagementScore,
    engagementLabel: post.engagementLabel,
  }));
  return <AdminDashboard initialPosts={serialized} initialReferences={references.map((reference) => ({
    ...reference,
    createdAt: reference.createdAt.toISOString(),
  }))} />;
}
