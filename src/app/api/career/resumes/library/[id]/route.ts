import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { getOrCreateProfile } from "@/lib/career-engine";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const profile = await getOrCreateProfile();
  const resume = await prisma.authorizedResume.findFirst({ where: { id, profileId: profile.id }, select: { originalName: true, contentType: true, fileData: true } });
  if (!resume) return NextResponse.json({ error: "Currículo autorizado não encontrado." }, { status: 404 });
  return new Response(new Uint8Array(resume.fileData), {
    headers: {
      "Content-Type": resume.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(resume.originalName)}`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
