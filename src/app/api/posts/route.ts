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
  })));
}
