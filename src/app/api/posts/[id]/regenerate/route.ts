import { NextResponse } from "next/server";
import { PostStatus } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { prisma } from "@/lib/prisma";

const editableStatuses = [
  PostStatus.DRAFT,
  PostStatus.AWAITING_APPROVAL,
  PostStatus.APPROVED,
  PostStatus.SCHEDULED,
  PostStatus.REJECTED,
  PostStatus.REJECTED_PENDING_FEEDBACK,
] as const;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) {
    return NextResponse.json({ error: "Configure o DASHBOARD_ADMIN_TOKEN para regenerar o post." }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "ID de post inválido." }, { status: 400 });
  const body = await request.json() as { feedback?: unknown };
  if (typeof body.feedback !== "string" || body.feedback.trim().length < 5) {
    return NextResponse.json({ error: "Descreva pelo menos uma melhoria desejada." }, { status: 400 });
  }
  const feedback = body.feedback.trim().slice(0, 4000);
  const current = await prisma.post.findUnique({ where: { id }, select: { status: true } });
  if (!current) return NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
  if (current.status === PostStatus.PUBLISHED || current.status === PostStatus.PUBLISHING) {
    return NextResponse.json({ error: "Posts publicados ou em publicação não podem ser regenerados." }, { status: 409 });
  }
  if (current.status === PostStatus.REGENERATING) {
    return NextResponse.json({ queued: true, alreadyQueued: true }, { status: 202 });
  }
  if (!editableStatuses.includes(current.status as (typeof editableStatuses)[number])) {
    return NextResponse.json({ error: "Este post não está disponível para edição." }, { status: 409 });
  }

  const locked = await prisma.post.updateMany({
    where: { id, status: current.status },
    data: { status: PostStatus.REGENERATING, feedbackText: feedback },
  });
  if (locked.count === 0) return NextResponse.json({ queued: true, alreadyQueued: true }, { status: 202 });

  try {
    await inngest.send({ name: "posts/reformulate.requested", data: { postId: id, feedback } });
  } catch (error) {
    await prisma.post.updateMany({
      where: { id, status: PostStatus.REGENERATING },
      data: { status: current.status, feedbackText: feedback },
    });
    console.error("Falha ao enfileirar regeneração do dashboard:", error);
    return NextResponse.json({ error: "Não foi possível iniciar a regeneração." }, { status: 502 });
  }

  return NextResponse.json({ queued: true, status: PostStatus.REGENERATING }, { status: 202 });
}
