import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { prisma } from "@/lib/prisma";

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
  if (!post) return NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400 }); }
  const impressions = integer(body.impressions);
  const reactions = integer(body.reactions);
  const comments = integer(body.comments);
  const shares = integer(body.shares);
  const profileViews = integer(body.profileViews);
  if (impressions === 0 && reactions === 0 && comments === 0 && shares === 0 && profileViews === 0) return NextResponse.json({ error: "Informe pelo menos uma métrica." }, { status: 400 });
  const engagementScore = impressions > 0 ? Math.min(100, ((reactions * 2 + comments * 5 + shares * 6) / impressions) * 1000) : null;
  const metric = await prisma.postMetric.create({ data: { postId: id, impressions, reactions, comments, shares, profileViews, engagementScore } });
  await prisma.post.update({ where: { id }, data: { engagementScore } });
  return NextResponse.json({ ...metric, engagementScore });
}
