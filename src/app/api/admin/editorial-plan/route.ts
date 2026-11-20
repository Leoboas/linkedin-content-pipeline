import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { isValidLanguageDistribution, normalizeLanguageDistribution } from "@/lib/language-planner";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, postsPerWeek: true, languageDistribution: true } });
  if (!editorialLine) return NextResponse.json({ error: "Linha editorial não encontrada." }, { status: 404 });
  return NextResponse.json({ postsPerWeek: editorialLine.postsPerWeek, languageDistribution: normalizeLanguageDistribution(editorialLine.languageDistribution, editorialLine.postsPerWeek) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const body = await request.json() as { postsPerWeek?: unknown; languageDistribution?: unknown };
    const postsPerWeek = Number(body.postsPerWeek);
    if (!Number.isInteger(postsPerWeek) || postsPerWeek < 1 || postsPerWeek > 4) {
      return NextResponse.json({ error: "A frequência semanal deve estar entre 1 e 4 posts." }, { status: 400 });
    }
    if (!isValidLanguageDistribution(body.languageDistribution, postsPerWeek)) {
      return NextResponse.json({ error: "Informe uma distribuição válida entre pt-BR e en-US." }, { status: 400 });
    }
    const languageDistribution = normalizeLanguageDistribution(body.languageDistribution, postsPerWeek);
    const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!editorialLine) return NextResponse.json({ error: "Linha editorial não encontrada." }, { status: 404 });
    const updated = await prisma.editorialLine.update({ where: { id: editorialLine.id }, data: { postsPerWeek, languageDistribution } });
    return NextResponse.json({ postsPerWeek: updated.postsPerWeek, languageDistribution: normalizeLanguageDistribution(updated.languageDistribution, updated.postsPerWeek) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[editorial-plan] update failed", error);
    return NextResponse.json({ error: "Não foi possível atualizar o planejamento editorial." }, { status: 500 });
  }
}
