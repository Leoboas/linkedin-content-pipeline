import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { parseDateTimeLocalInBrazil } from "@/lib/dates";
import { getNextPipelineBaseDate } from "@/lib/scheduling";
import { prisma } from "@/lib/prisma";
import { PostStatus } from "@prisma/client";
import { weeklyGenerationKeys } from "@/lib/post-generation-guard";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})) as { weekStart?: unknown };
    let weekStart: string | undefined;
    let baseDate = getNextPipelineBaseDate();
    if (body.weekStart !== undefined) {
      if (typeof body.weekStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)) {
        return NextResponse.json({ error: "weekStart deve ser uma data YYYY-MM-DD." }, { status: 400 });
      }
      const parsed = parseDateTimeLocalInBrazil(`${body.weekStart}T00:00`);
      if (parsed.getUTCDay() !== 1) return NextResponse.json({ error: "A semana-alvo deve começar na segunda-feira." }, { status: 400 });
      weekStart = parsed.toISOString();
      baseDate = parsed;
    }
    const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" }, select: { postsPerWeek: true } });
    if (!editorialLine) return NextResponse.json({ error: "Configure uma linha editorial antes de gerar o calendário." }, { status: 409 });
    const weekKey = baseDate.toISOString().slice(0, 10);
    const keys = weeklyGenerationKeys(weekKey, editorialLine.postsPerWeek);
    const existing = await prisma.post.count({ where: { generationKey: { in: keys } } });
    if (existing >= keys.length) return NextResponse.json({ error: `O calendário da semana de ${weekKey} já possui os ${keys.length} slots. Nenhum post antigo será reenviado.` }, { status: 409 });
    const awaitingApproval = await prisma.post.count({ where: { status: PostStatus.AWAITING_APPROVAL } });
    if (awaitingApproval >= 3) return NextResponse.json({ error: "A fila já tem 3 posts aguardando aprovação. Aprove, recuse ou arquive antes de gerar outro lote." }, { status: 409 });
    await inngest.send({ name: "posts/generate.weekly", data: { triggeredAt: new Date().toISOString(), ...(weekStart ? { weekStart } : {}) } });
    return NextResponse.json({ accepted: true, queued: true, weekStart: body.weekStart ?? null });
  } catch (error) {
    console.error("[posts/generate] falha ao gerar lote", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao gerar lote." }, { status: 502 });
  }
}
