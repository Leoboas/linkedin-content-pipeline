import { NextResponse } from "next/server";
import { PostStatus } from "@prisma/client";
import { formatDateTimeLocalInBrazil } from "@/lib/dates";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { prisma } from "@/lib/prisma";

const activeStatuses: PostStatus[] = [
  PostStatus.DRAFT,
  PostStatus.AWAITING_APPROVAL,
  PostStatus.REGENERATING,
  PostStatus.APPROVED,
  PostStatus.SCHEDULED,
  PostStatus.PUBLISHING,
  PostStatus.PUBLISHED,
];

const backlogStatuses: PostStatus[] = [
  PostStatus.CANCELLED,
  PostStatus.ARCHIVED,
  PostStatus.REJECTED,
  PostStatus.REJECTED_PENDING_FEEDBACK,
];

function serializeDate(value: Date): string {
  return `${formatDateTimeLocalInBrazil(value)}:00-03:00`;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const view = new URL(request.url).searchParams.get("view") === "backlog" ? "backlog" : "active";
  const posts = await prisma.post.findMany({
    where: { status: { in: view === "backlog" ? backlogStatuses : activeStatuses } },
    orderBy: { scheduledFor: "asc" },
    take: 200,
    include: { creativeBriefs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, version: true, thesis: true, technicalConflict: true, concreteProblem: true, visualConcept: true, shortOverlayTitle: true, evidenceSnapshot: true, effectivePrompt: true, mediaUrl: true, aestheticScore: true, semanticScore: true, technicalScore: true, reviewStatus: true, reviewSnapshot: true, postVersionId: true, contentBrief: true, visualBrief: true } } },
  });
  return NextResponse.json(posts.map((post) => ({
    id: post.id,
    title: post.title,
    textContent: post.textContent,
    imagePrompt: post.imagePrompt,
    mediaUrl: post.mediaUrl,
    editorialPillar: post.editorialPillar,
    status: post.status,
    scheduledFor: serializeDate(post.scheduledFor),
    scheduledDate: serializeDate(post.scheduledDate ?? post.scheduledFor),
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
  })));
}
