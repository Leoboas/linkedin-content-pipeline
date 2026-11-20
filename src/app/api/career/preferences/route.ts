import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateProfile } from "@/lib/career-engine";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { asStringArray } from "@/lib/career-rag";

const defaultLocations = ["Brasil", "United States", "Europe", "Remote"];

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const profile = await getOrCreateProfile();
  const saved = await prisma.jobSearchPreference.findUnique({ where: { profileId: profile.id } });
  return NextResponse.json({
    targetTitles: asStringArray(saved?.targetTitles).length ? asStringArray(saved?.targetTitles) : asStringArray(profile.targetTitles),
    locations: asStringArray(saved?.locations).length ? asStringArray(saved?.locations) : defaultLocations,
    minimumMatchScore: saved?.minimumMatchScore ?? 70,
    remoteOnly: saved?.remoteOnly ?? false,
    autoApplyEnabled: false,
  });
}

export async function PUT(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }

  const cleanList = (value: unknown, max: number, maxLength: number): string[] => Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => item && item.length <= maxLength))].slice(0, max)
    : [];
  const targetTitles = cleanList(body.targetTitles, 12, 100);
  const locations = cleanList(body.locations, 10, 100);
  const minimumMatchScore = Number(body.minimumMatchScore);
  if (!targetTitles.length || !locations.length) return NextResponse.json({ error: "Informe pelo menos um cargo e uma localidade." }, { status: 400 });
  if (!Number.isInteger(minimumMatchScore) || minimumMatchScore < 0 || minimumMatchScore > 100) return NextResponse.json({ error: "O Match mínimo deve ser um inteiro entre 0 e 100." }, { status: 400 });

  const profile = await getOrCreateProfile();
  const preference = await prisma.jobSearchPreference.upsert({
    where: { profileId: profile.id },
    create: { profileId: profile.id, targetTitles, locations, minimumMatchScore, remoteOnly: body.remoteOnly === true, autoApplyEnabled: false },
    update: { targetTitles, locations, minimumMatchScore, remoteOnly: body.remoteOnly === true, autoApplyEnabled: false },
  });
  return NextResponse.json({ targetTitles: asStringArray(preference.targetTitles), locations: asStringArray(preference.locations), minimumMatchScore: preference.minimumMatchScore, remoteOnly: preference.remoteOnly, autoApplyEnabled: false });
}
