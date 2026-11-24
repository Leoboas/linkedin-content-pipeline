import { NextResponse } from "next/server";
import { getOrCreateProfile } from "@/lib/career-engine";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { prisma } from "@/lib/prisma";
import { buildApplicationKitDocx, buildApplicationKitPdf, kitFilenameStem } from "@/lib/career-application-kit-documents";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (format !== "pdf" && format !== "docx") return NextResponse.json({ error: "format deve ser pdf ou docx." }, { status: 400 });
  const profile = await getOrCreateProfile();
  const kit = await prisma.applicationKit.findFirst({ where: { id, application: { profileId: profile.id } }, include: { application: { include: { job: { select: { title: true, company: true } } } } } });
  if (!kit) return NextResponse.json({ error: "Application Kit não encontrado." }, { status: 404 });
  const documentData = { language: kit.language, tailoredResume: kit.tailoredResume as never, coverLetter: kit.coverLetter, jobTitle: kit.application.job.title, company: kit.application.job.company, version: kit.version } as const;
  const file = format === "pdf" ? await buildApplicationKitPdf(documentData) : await buildApplicationKitDocx(documentData);
  const contentType = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const filename = `${kitFilenameStem(kit.application.job.title, kit.version)}.${format}`;
  return new Response(new Uint8Array(file), { headers: {
    "Content-Type": contentType,
    "Content-Length": String(file.byteLength),
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
