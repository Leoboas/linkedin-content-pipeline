import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateProfile } from "@/lib/career-engine";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { normalizeSkills } from "@/lib/skills-normalizer";

function jsonError(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  try {
    const profile = await getOrCreateProfile();
    return NextResponse.json(profile);
  } catch (error) {
    console.error("Falha ao carregar perfil profissional:", error);
    return jsonError(error instanceof Error ? error.message : "Falha ao carregar perfil.", 500);
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonError("JSON inválido.", 400); }
  const required = ["name", "headline", "about"];
  if (required.some((key) => typeof body[key] !== "string" || !(body[key] as string).trim())) return jsonError("name, headline e about são obrigatórios.", 400);
  const skills = Array.isArray(body.skills) ? body.skills.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
  const targetTitles = Array.isArray(body.targetTitles) ? body.targetTitles.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
  const current = await prisma.candidateProfile.findFirst({ orderBy: { createdAt: "asc" } });
  const data = { name: (body.name as string).trim(), headline: (body.headline as string).trim(), about: (body.about as string).trim(), location: typeof body.location === "string" ? body.location.trim() || null : null, linkedinUrl: typeof body.linkedinUrl === "string" ? body.linkedinUrl.trim() || null : null, skills: normalizeSkills(skills), targetTitles };
  const profile = current ? await prisma.candidateProfile.update({ where: { id: current.id }, data }) : await prisma.candidateProfile.create({ data });
  return NextResponse.json(profile);
}
