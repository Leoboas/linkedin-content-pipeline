import { NextResponse } from "next/server";
import { PostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishPostToLinkedIn } from "@/lib/linkedin";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json()) as { postId?: unknown };
  if (typeof body.postId !== "string") {
    return NextResponse.json({ error: "postId é obrigatório." }, { status: 400 });
  }

  const post = await prisma.post.findUnique({ where: { id: body.postId } });
  if (!post) return NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
  if (post.status !== PostStatus.APPROVED) {
    return NextResponse.json({ error: "O post precisa estar aprovado." }, { status: 409 });
  }

  const published = await publishPostToLinkedIn(post);
  await prisma.post.update({
    where: { id: post.id },
    data: { status: PostStatus.PUBLISHED, publishedAt: new Date(), linkedinPostId: published.id },
  });
  return NextResponse.json(published);
}
