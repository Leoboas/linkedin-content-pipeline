import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateProfile } from "@/lib/career-engine";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { asStringArray } from "@/lib/career-rag";
import { CAREER_APPLICATION_CAPABILITIES, CAREER_SOURCE_REGISTRY } from "@/lib/job-source-connectors";
import { getDefaultCareerTargetTitles, normalizeCareerTargetTitles } from "../../../../../config/job-targets";

const defaultLocations = ["Brasil", "United States", "Europe", "Remote"];

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const profile = await getOrCreateProfile();
  const saved = await prisma.jobSearchPreference.findUnique({ where: { profileId: profile.id } });
  const savedTitles = asStringArray(saved?.targetTitles);
  const profileTitles = asStringArray(profile.targetTitles);
  const normalizedTargets = normalizeCareerTargetTitles(savedTitles.length ? savedTitles : profileTitles);
  return NextResponse.json({
    targetTitles: normalizedTargets.length ? normalizedTargets : getDefaultCareerTargetTitles(),
    locations: asStringArray(saved?.locations).length ? asStringArray(saved?.locations) : defaultLocations,
    minimumMatchScore: saved?.minimumMatchScore ?? 65,
    remoteOnly: saved?.remoteOnly ?? false,
    sourceKeys: asStringArray(saved?.sourceKeys).length ? asStringArray(saved?.sourceKeys) : ["CODERIO_LEVER", "HIMALAYAS", "REMOTIVE", "REMOTE_OK", "WE_WORK_REMOTELY"],
    employerMarkets: asStringArray(saved?.employerMarkets).length ? asStringArray(saved?.employerMarkets) : ["US", "EU", "GLOBAL"],
    sourceRegistry: CAREER_SOURCE_REGISTRY,
    applicationCapabilities: CAREER_APPLICATION_CAPABILITIES,
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
  const targetTitles = normalizeCareerTargetTitles(cleanList(body.targetTitles, 20, 100));
  const locations = cleanList(body.locations, 10, 100);
  const minimumMatchScore = Number(body.minimumMatchScore);
  const validSourceKeys = new Set<string>(CAREER_SOURCE_REGISTRY.filter((source) => source.mode === "ACTIVE_API" || source.mode === "ACTIVE_RSS").map((source) => source.key));
  const sourceKeys = cleanList(body.sourceKeys, 12, 40).filter((key) => validSourceKeys.has(key));
  const employerMarkets = cleanList(body.employerMarkets, 3, 20).filter((market) => ["US", "EU", "GLOBAL"].includes(market));
  if (!targetTitles.length || !locations.length) return NextResponse.json({ error: "Selecione cargos de engenharia reconhecidos e informe ao menos uma localidade." }, { status: 400 });
  if (!sourceKeys.length) return NextResponse.json({ error: "Selecione pelo menos uma fonte com integração ativa." }, { status: 400 });
  if (!employerMarkets.length) return NextResponse.json({ error: "Selecione ao menos um mercado empresarial." }, { status: 400 });
  if (!Number.isInteger(minimumMatchScore) || minimumMatchScore < 0 || minimumMatchScore > 100) return NextResponse.json({ error: "O Match mínimo deve ser um inteiro entre 0 e 100." }, { status: 400 });

  const profile = await getOrCreateProfile();
  const preference = await prisma.jobSearchPreference.upsert({
    where: { profileId: profile.id },
    create: { profileId: profile.id, targetTitles, locations, minimumMatchScore, remoteOnly: body.remoteOnly === true, sourceKeys, employerMarkets, autoApplyEnabled: false },
    update: { targetTitles, locations, minimumMatchScore, remoteOnly: body.remoteOnly === true, sourceKeys, employerMarkets, autoApplyEnabled: false },
  });
  return NextResponse.json({ targetTitles: asStringArray(preference.targetTitles), locations: asStringArray(preference.locations), minimumMatchScore: preference.minimumMatchScore, remoteOnly: preference.remoteOnly, sourceKeys: asStringArray(preference.sourceKeys), employerMarkets: asStringArray(preference.employerMarkets), sourceRegistry: CAREER_SOURCE_REGISTRY, applicationCapabilities: CAREER_APPLICATION_CAPABILITIES, autoApplyEnabled: false });
}
