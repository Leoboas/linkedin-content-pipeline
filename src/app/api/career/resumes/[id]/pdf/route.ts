import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { getOrCreateProfile } from "@/lib/career-engine";
import { prisma } from "@/lib/prisma";

type ResumeContent = {
  headline?: string;
  summary?: string;
  skills?: Array<{ category?: string; items?: string[] }>;
  experience?: Array<{ role?: string; company?: string; period?: string; bullets?: string[] }>;
  projects?: Array<{ name?: string; description?: string; stack?: string[] }>;
  education?: string[];
  languages?: string[];
};

function safeFilename(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 70) || "curriculo";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const profile = await getOrCreateProfile();
  const draft = await prisma.resumeDraft.findFirst({ where: { id, profileId: profile.id } });
  if (!draft) return NextResponse.json({ error: "Currículo não encontrado." }, { status: 404 });

  const content = (draft.content ?? {}) as ResumeContent;
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595;
  const margin = 48;
  const fontSize = 10;
  const lineHeight = 14;
  let page = pdf.addPage([pageWidth, 842]);
  let y = 790;
  const printable = (value: string) => value.replace(/[^\x20-\xFF\n\t]/g, "?");
  const addPageIfNeeded = (height = lineHeight) => {
    if (y - height < 48) { page = pdf.addPage([pageWidth, 842]); y = 790; }
  };
  const wrap = (value: string, size = fontSize): string[] => {
    const words = printable(value).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (regular.widthOfTextAtSize(candidate, size) <= pageWidth - (margin * 2)) current = candidate;
      else { if (current) lines.push(current); current = word; }
    }
    if (current) lines.push(current);
    return lines;
  };
  const write = (value: string, options: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = options.size ?? fontSize;
    for (const line of wrap(value, size)) {
      addPageIfNeeded(size + 5);
      page.drawText(line, { x: margin, y, size, font: options.bold ? bold : regular, color: options.color ?? rgb(0.1, 0.13, 0.18) });
      y -= Math.max(lineHeight, size + 4);
    }
    y -= options.gap ?? 0;
  };
  const heading = (value: string) => { addPageIfNeeded(28); y -= 8; write(value.toUpperCase(), { bold: true, size: 11, color: rgb(0.03, 0.32, 0.52), gap: 3 }); };
  const bullet = (value: string) => write(`• ${value}`);

  write(profile.name, { bold: true, size: 20, color: rgb(0.03, 0.12, 0.22), gap: 2 });
  write(content.headline ?? profile.headline, { bold: true, size: 11, color: rgb(0.16, 0.25, 0.34), gap: 8 });
  if (profile.location || profile.linkedinUrl) write([profile.location, profile.linkedinUrl].filter(Boolean).join(" · "), { size: 9, color: rgb(0.3, 0.35, 0.4), gap: 4 });
  if (content.summary) { heading("Resumo profissional"); write(content.summary, { gap: 3 }); }
  if (content.skills?.length) { heading("Competências"); for (const group of content.skills) write(`${group.category ?? "Skills"}: ${(group.items ?? []).join(", ")}`, { gap: 2 }); }
  if (content.experience?.length) { heading("Experiência profissional"); for (const item of content.experience) { write([item.role, item.company].filter(Boolean).join(" · "), { bold: true }); if (item.period) write(item.period, { size: 9, color: rgb(0.35, 0.4, 0.45) }); for (const itemBullet of item.bullets ?? []) bullet(itemBullet); y -= 4; } }
  if (content.projects?.length) { heading("Projetos selecionados"); for (const project of content.projects) { write(project.name ?? "Projeto", { bold: true }); if (project.description) write(project.description); if (project.stack?.length) write(`Stack: ${project.stack.join(", ")}`, { size: 9, color: rgb(0.35, 0.4, 0.45), gap: 3 }); } }
  if (content.education?.length) { heading("Formação"); content.education.forEach((item) => bullet(item)); }
  if (content.languages?.length) { heading("Idiomas"); write(content.languages.join(", ")); }

  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeFilename(draft.targetRole)}-${draft.id.slice(0, 8)}.pdf"`, "Cache-Control": "private, no-store" } });
}
