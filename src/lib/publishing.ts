import { PostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishPostToLinkedIn } from "@/lib/linkedin";

export async function publishDuePost(postId: string): Promise<
  { published: true; id: string } | { published: false; reason: string }
> {
  const now = new Date();
  console.info("[linkedin] attempting due post", { postId, now: now.toISOString() });
  const existing = await prisma.post.findUnique({
    where: { id: postId },
    select: { status: true, publishedAt: true },
  });
  if (!existing) return { published: false, reason: "post-not-found" };
  if (existing.status === PostStatus.PUBLISHED || existing.publishedAt !== null) {
    console.info("[linkedin] duplicate publication prevented", { postId, publishedAt: existing.publishedAt });
    return { published: false, reason: "already-published" };
  }

  const claimed = await prisma.post.updateMany({
    where: {
      id: postId,
      status: { in: [PostStatus.APPROVED, PostStatus.SCHEDULED] },
      publishedAt: null,
      scheduledFor: { lte: now },
    },
    data: { status: PostStatus.PUBLISHING },
  });
  if (claimed.count === 0) {
    return { published: false, reason: "post-not-due-or-already-claimed" };
  }

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return { published: false, reason: "post-not-found" };
  if (post.publishedAt !== null || post.status === PostStatus.PUBLISHED) {
    console.info("[linkedin] duplicate publication prevented after claim", { postId });
    return { published: false, reason: "already-published" };
  }

  try {
    const published = await publishPostToLinkedIn(post);
    const finalized = await prisma.post.updateMany({
      where: { id: post.id, status: PostStatus.PUBLISHING, publishedAt: null },
      data: {
        status: PostStatus.PUBLISHED,
        publishedAt: new Date(),
        linkedinPostId: published.id,
      },
    });
    if (finalized.count === 0) {
      console.info("[linkedin] publication finalization skipped; state already changed", { postId: post.id });
      return { published: false, reason: "already-finalized" };
    }
    console.info("[linkedin] post published", { postId: post.id, linkedinPostId: published.id });
    return { published: true, id: published.id };
  } catch (error) {
    // Permite que o Inngest ou a próxima manutenção tente novamente.
    await prisma.post.updateMany({
      where: { id: post.id, status: PostStatus.PUBLISHING },
      data: { status: PostStatus.SCHEDULED },
    });
    console.error("[linkedin] publication failed", {
      postId: post.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
