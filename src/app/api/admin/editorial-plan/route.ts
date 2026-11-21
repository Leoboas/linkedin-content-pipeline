import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { isValidWeeklySchedule, normalizeWeeklySchedule } from "@/lib/editorial-calendar";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, weeklySchedule: true } });
  if (!editorialLine) return NextResponse.json({ error: "Linha editorial não encontrada." }, { status: 404 });
  return NextResponse.json({ postsPerWeek: 4, languageDistribution: { "pt-BR": 2, "en-US": 2 }, weeklySchedule: normalizeWeeklySchedule(editorialLine.weeklySchedule) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const body = await request.json() as { weeklySchedule?: unknown };
    if (!isValidWeeklySchedule(body.weeklySchedule)) {
      return NextResponse.json({ error: "Edite somente os horários dos quatro slots do calendário-base." }, { status: 400 });
    }
    const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!editorialLine) return NextResponse.json({ error: "Linha editorial não encontrada." }, { status: 404 });
    const weeklySchedule = normalizeWeeklySchedule(body.weeklySchedule);
    const updated = await prisma.editorialLine.update({ where: { id: editorialLine.id }, data: { postsPerWeek: 4, languageDistribution: { "pt-BR": 2, "en-US": 2 }, weeklySchedule: JSON.parse(JSON.stringify(weeklySchedule)) as Prisma.InputJsonValue } });
    return NextResponse.json({ postsPerWeek: 4, languageDistribution: { "pt-BR": 2, "en-US": 2 }, weeklySchedule: normalizeWeeklySchedule(updated.weeklySchedule) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[editorial-plan] update failed", error);
    return NextResponse.json({ error: "Não foi possível atualizar o planejamento editorial." }, { status: 500 });
  }
}
