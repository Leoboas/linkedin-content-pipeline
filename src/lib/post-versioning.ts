import { createHash } from "node:crypto";
import type { Prisma, PostStatus } from "@prisma/client";

export interface PostTextSnapshot {
  title: string;
  textContent: string;
  slidesJson?: Prisma.InputJsonValue | null;
  imagePrompt?: string | null;
  mediaUrl?: string | null;
  language: string;
}

export function hashPostContent(snapshot: PostTextSnapshot): string {
  const canonical = JSON.stringify({
    title: snapshot.title,
    textContent: snapshot.textContent,
    slidesJson: snapshot.slidesJson ?? null,
    imagePrompt: snapshot.imagePrompt ?? null,
    language: snapshot.language,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export async function createPostTextVersion(
  tx: Prisma.TransactionClient,
  input: { postId: string; snapshot: PostTextSnapshot; reason: string },
): Promise<string> {
  const latest = await tx.postVersion.findFirst({
    where: { postId: input.postId, versionNumber: { not: null } },
    orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
    select: { versionNumber: true },
  });
  const versionNumber = (latest?.versionNumber ?? 0) + 1;
  const version = await tx.postVersion.create({
    data: {
      postId: input.postId,
      versionNumber,
      contentHash: hashPostContent(input.snapshot),
      title: input.snapshot.title,
      textContent: input.snapshot.textContent,
      slidesJson: input.snapshot.slidesJson ?? undefined,
      imagePrompt: input.snapshot.imagePrompt ?? null,
      mediaUrl: input.snapshot.mediaUrl ?? null,
      reason: input.reason,
    },
    select: { id: true },
  });

  const post = await tx.post.findUnique({
    where: { id: input.postId },
    select: { currentVersionId: true, approvedCreativeBriefId: true },
  });
  if (post?.approvedCreativeBriefId) {
    const oldBrief = await tx.creativeBrief.findUnique({ where: { id: post.approvedCreativeBriefId }, select: { postVersionId: true } });
    if (oldBrief?.postVersionId) {
      await tx.postApprovalEvent.create({ data: {
        postId: input.postId,
        postVersionId: oldBrief.postVersionId,
        creativeBriefId: post.approvedCreativeBriefId,
        eventType: "INVALIDATED",
        reason: "A nova versão textual substituiu o conteúdo aprovado.",
      } });
    }
  }
  await tx.post.update({ where: { id: input.postId }, data: { currentVersionId: version.id, approvedCreativeBriefId: null } });
  return version.id;
}

export async function invalidateApprovalForCreativeChange(
  tx: Prisma.TransactionClient,
  input: { postId: string; reason: string },
): Promise<void> {
  const post = await tx.post.findUnique({ where: { id: input.postId }, select: { approvedCreativeBriefId: true } });
  if (!post?.approvedCreativeBriefId) return;
  const brief = await tx.creativeBrief.findUnique({ where: { id: post.approvedCreativeBriefId }, select: { postVersionId: true } });
  if (brief?.postVersionId) {
    await tx.postApprovalEvent.create({ data: {
      postId: input.postId,
      postVersionId: brief.postVersionId,
      creativeBriefId: post.approvedCreativeBriefId,
      eventType: "INVALIDATED",
      reason: input.reason,
    } });
  }
  await tx.post.update({ where: { id: input.postId }, data: { approvedCreativeBriefId: null } });
}

export function isApprovalInvalidatedByStatus(status: PostStatus): boolean {
  return status === "APPROVED" || status === "SCHEDULED";
}
