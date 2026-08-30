import { PostStatus } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

const activeQueueStatuses: PostStatus[] = [
  PostStatus.AWAITING_APPROVAL,
  PostStatus.DRAFT,
  PostStatus.APPROVED,
  PostStatus.SCHEDULED,
  PostStatus.REGENERATING,
  PostStatus.REJECTED_PENDING_FEEDBACK,
];

export async function requestBatchIfStockIsLow(options: { force?: boolean } = {}): Promise<{
  remaining: number;
  requested: boolean;
}> {
  const remaining = await prisma.post.count({
    where: { status: { in: activeQueueStatuses } },
  });
  if (!options.force && remaining > 1) return { remaining, requested: false };

  const editorialLine = await prisma.editorialLine.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, lastStockRefillAt: true },
  });
  if (!editorialLine) return { remaining, requested: false };

  // Deduplica disparos de cron/Inngest durante uma janela curta.
  const lockUntil = new Date(Date.now() - 15 * 60 * 1000);
  const locked = await prisma.editorialLine.updateMany({
    where: {
      id: editorialLine.id,
      OR: [
        { lastStockRefillAt: null },
        { lastStockRefillAt: { lt: lockUntil } },
      ],
    },
    data: { lastStockRefillAt: new Date() },
  });
  if (locked.count === 0) return { remaining, requested: false };

  const batchKey = `refill:${new Date().toISOString()}`;
  try {
    await inngest.send({ name: "pipeline/generate-batch", data: { batchKey } });
    return { remaining, requested: true };
  } catch (error) {
    await prisma.editorialLine.updateMany({
      where: { id: editorialLine.id },
      data: { lastStockRefillAt: null },
    });
    throw error;
  }
}
