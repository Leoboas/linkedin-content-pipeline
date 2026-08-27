import { PostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishPostToLinkedIn } from "@/lib/linkedin";

export async function publishDuePost(postId: string): Promise<
  { published: true; id: string } | { published: false; reason: string }
> {
  const now = new Date();
  const claimed = await prisma.post.updateMany({
    where: {
      id: postId,
      status: { in: [PostStatus.APPROVED, PostStatus.SCHEDULED] },
      scheduledFor: { lte: now },
    },
    data: { status: PostStatus.PUBLISHING },
  });
  if (claimed.count === 0) {
    return { published: false, reason: "post-not-due-or-already-claimed" };
  }

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return { published: false, reason: "post-not-found" };

  try {
    const published = await publishPostToLinkedIn(post);
    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: PostStatus.PUBLISHED,
        publishedAt: new Date(),
        linkedinPostId: published.id,
      },
    });
    return { published: true, id: published.id };
  } catch (error) {
    // Permite que o Inngest ou a próxima manutenção tente novamente.
    await prisma.post.updateMany({
      where: { id: post.id, status: PostStatus.PUBLISHING },
      data: { status: PostStatus.SCHEDULED },
    });
    throw error;
  }
}
