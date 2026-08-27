import { NextResponse } from "next/server";
import { PostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishDuePost } from "@/lib/publishing";
import { reformulatePostFromFeedback } from "@/lib/reformulation";
import { requestBatchIfStockIsLow } from "@/lib/stock";

export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  const errors: string[] = [];
  let regenerated = 0;
  let published = 0;

  // Recupera uma execução de feedback que foi aceita pelo webhook, mas não foi
  // consumida pelo Inngest ou expirou durante a chamada à IA.
  const staleRegenerations = await prisma.post.findMany({
    where: {
      status: PostStatus.REGENERATING,
      updatedAt: { lt: staleBefore },
      feedbackText: { not: null },
    },
    select: { id: true, feedbackText: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
    take: 3,
  });

  for (const post of staleRegenerations) {
    const reset = await prisma.post.updateMany({
      where: {
        id: post.id,
        status: PostStatus.REGENERATING,
        updatedAt: post.updatedAt,
      },
      data: { status: PostStatus.REJECTED_PENDING_FEEDBACK },
    });
    if (reset.count === 0 || !post.feedbackText?.trim()) continue;

    const claimed = await prisma.post.updateMany({
      where: { id: post.id, status: PostStatus.REJECTED_PENDING_FEEDBACK },
      data: { status: PostStatus.REGENERATING, feedbackText: post.feedbackText },
    });
    if (claimed.count === 0) continue;

    try {
      await reformulatePostFromFeedback(post.id, post.feedbackText);
      regenerated += 1;
    } catch (error) {
      await prisma.post.updateMany({
        where: { id: post.id, status: PostStatus.REGENERATING },
        data: { status: PostStatus.REJECTED_PENDING_FEEDBACK },
      });
      errors.push(`regeneration:${post.id}:${error instanceof Error ? error.message : "erro desconhecido"}`);
    }
  }

  // Caminho de recuperação para posts aprovados cujo evento de publicação não
  // foi entregue. A alteração APPROVED/SCHEDULED -> PUBLISHING é atômica, logo
  // não há publicação duplicada se o Inngest e este cron rodarem juntos.
  const duePosts = await prisma.post.findMany({
    where: {
      status: { in: [PostStatus.APPROVED, PostStatus.SCHEDULED] },
      scheduledFor: { lte: now },
    },
    select: { id: true },
    orderBy: { scheduledFor: "asc" },
    take: 10,
  });

  for (const post of duePosts) {
    try {
      const result = await publishDuePost(post.id);
      if (result.published) published += 1;
    } catch (error) {
      errors.push(`publish:${post.id}:${error instanceof Error ? error.message : "erro desconhecido"}`);
    }
  }

  let stock: Awaited<ReturnType<typeof requestBatchIfStockIsLow>> | null = null;
  try {
    stock = await requestBatchIfStockIsLow();
  } catch (error) {
    errors.push(`stock:${error instanceof Error ? error.message : "erro desconhecido"}`);
  }

  return NextResponse.json({
    ok: errors.length === 0,
    regenerated,
    published,
    stock,
    errors,
  }, { status: errors.length === 0 ? 200 : 207 });
}
