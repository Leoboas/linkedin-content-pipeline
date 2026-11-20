import { NextResponse } from "next/server";
import { PostStatus, Prisma } from "@prisma/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { observedInteractionRate, parseOptionalNonNegativeInteger, snapshotIdempotencyKey } from "@/lib/analytics-data";
import { prisma } from "@/lib/prisma";

const metricFields = [
  "impressions", "membersReached", "reactions", "comments", "shares", "postSaves", "postSends",
  "linkClicks", "premiumCtaClicks", "followersGained", "profileViewsFromContent",
] as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const post = await prisma.post.findUnique({ where: { id }, select: { id: true, status: true, linkedinPostId: true, publishedAt: true } });
  if (!post) return NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
  if (post.status !== PostStatus.PUBLISHED || !post.publishedAt) {
    return NextResponse.json({ error: "Métricas só podem ser registradas para posts publicados." }, { status: 409 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400 }); }

  const values: Record<string, number | null> = {};
  for (const field of metricFields) {
    const parsed = parseOptionalNonNegativeInteger(body[field]);
    if (!parsed.valid) return NextResponse.json({ error: `Métrica inválida: ${field}. Informe um inteiro não negativo ou deixe em branco.` }, { status: 400 });
    values[field] = parsed.value;
  }
  // Compatibility for the previous form field; it represents attribution to this post.
  if (values.profileViewsFromContent === null && body.profileViews !== undefined) {
    const parsed = parseOptionalNonNegativeInteger(body.profileViews);
    if (!parsed.valid) return NextResponse.json({ error: "Métrica inválida: profileViews." }, { status: 400 });
    values.profileViewsFromContent = parsed.value;
  }
  if (Object.values(values).every((value) => value === null)) {
    return NextResponse.json({ error: "Informe pelo menos uma métrica observada. Campos vazios permanecem indisponíveis, não equivalem a zero." }, { status: 400 });
  }

  const allowedWindows = new Set(["24H", "72H", "7D", "LIFETIME"]);
  const measurementWindow = typeof body.measurementWindow === "string" && allowedWindows.has(body.measurementWindow)
    ? body.measurementWindow
    : "LIFETIME";
  const capturedAt = new Date();
  const engagementScore = observedInteractionRate({
    impressions: values.impressions ?? null,
    reactions: values.reactions ?? null,
    comments: values.comments ?? null,
    shares: values.shares ?? null,
  });
  const completeness = Object.values(values).filter((value) => value !== null).length === metricFields.length ? "AVAILABLE" : "PARTIAL";
  const idempotencyKey = snapshotIdempotencyKey(id, "MANUAL", measurementWindow, capturedAt);
  const data = {
    ...values,
    postId: id,
    linkedinPostId: post.linkedinPostId,
    publishedAtSnapshot: post.publishedAt,
    exposureHours: Number(((capturedAt.getTime() - post.publishedAt.getTime()) / 3_600_000).toFixed(2)),
    source: "MANUAL",
    apiVersion: null,
    measurementWindow,
    availability: completeness,
    interactionRate: engagementScore,
    capturedAt,
    idempotencyKey,
  } satisfies Prisma.PostMetricUncheckedCreateInput;

  const metric = await prisma.postMetric.upsert({
    where: { idempotencyKey },
    create: data,
    update: { ...values, availability: completeness, interactionRate: engagementScore, capturedAt },
  });
  return NextResponse.json({ ...metric, interactionRate: engagementScore });
}
