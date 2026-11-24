import { prisma } from "@/lib/prisma";
import { PostStatus } from "@prisma/client";
import { formatDateTimeLocalInBrazil } from "@/lib/dates";
import { AdminDashboard, type DashboardPost } from "./AdminDashboard";
import { cookies } from "next/headers";
import { DashboardLogin } from "@/app/auth/DashboardLogin";
import { isDashboardSessionValid, DASHBOARD_SESSION_COOKIE } from "@/lib/dashboard-auth";
import { normalizeWeeklySchedule } from "@/lib/editorial-calendar";

export const dynamic = "force-dynamic";

function serializeBrazilDate(date: Date): string {
  return `${formatDateTimeLocalInBrazil(date)}:00-03:00`;
}

export default async function AdminPage() {
  const cookieStore = await cookies();
  if (!isDashboardSessionValid(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value)) return <DashboardLogin nextPath="/admin" />;
  const [posts, references, editorialLine] = await Promise.all([
    prisma.post.findMany({
      where: { status: { in: [PostStatus.DRAFT, PostStatus.AWAITING_APPROVAL, PostStatus.REGENERATING, PostStatus.APPROVED, PostStatus.SCHEDULED, PostStatus.PUBLISHING, PostStatus.PUBLISHED] } },
      orderBy: { scheduledFor: "asc" }, take: 200,
      include: { creativeBriefs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, version: true, thesis: true, technicalConflict: true, concreteProblem: true, visualConcept: true, shortOverlayTitle: true, evidenceSnapshot: true, effectivePrompt: true, mediaUrl: true, aestheticScore: true, semanticScore: true, technicalScore: true, reviewStatus: true, reviewSnapshot: true, postVersionId: true, contentBrief: true, visualBrief: true } } },
    }),
    prisma.contentReference.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, content: true, sourceUrl: true, createdAt: true },
    }),
    prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" }, select: { weeklySchedule: true } }),
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
    language: post.language,
    topic: post.topic,
    editorialObjective: post.editorialObjective,
    formatType: post.formatType,
    qualityScore: post.qualityScore,
    qualityStatus: post.qualityStatus,
    qualityReview: post.qualityReview,
    evidenceSnapshot: post.creativeBriefs[0]?.evidenceSnapshot ?? null,
    creativeBrief: post.creativeBriefs[0] ?? null,
    currentVersionId: post.currentVersionId,
  }));
  return <AdminDashboard initialPosts={serialized} initialReferences={references.map((reference) => ({
    ...reference,
    createdAt: reference.createdAt.toISOString(),
  }))} initialEditorialPlan={{ postsPerWeek: 4, languageDistribution: { "pt-BR": 2, "en-US": 2 }, weeklySchedule: normalizeWeeklySchedule(editorialLine?.weeklySchedule) }} />;
}
