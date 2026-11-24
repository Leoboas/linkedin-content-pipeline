import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type ResumeLike = {
  headline?: string;
  summary?: string;
  skills?: Array<{ category?: string; items?: string[] }>;
  experience?: Array<{ role?: string; company?: string; period?: string; bullets?: string[] }>;
  projects?: Array<{ name?: string; description?: string; stack?: string[] }>;
  education?: string[];
  languages?: string[];
};

export interface ApplicationKitDocumentData {
  language: "PT_BR" | "EN";
  tailoredResume: ResumeLike;
  coverLetter: string;
  jobTitle: string;
  company: string | null;
  version: number;
}

function paragraphsFor(data: ApplicationKitDocumentData): Array<{ heading?: string; text: string; bullet?: boolean }> {
  const resume = data.tailoredResume;
  const lines: Array<{ heading?: string; text: string; bullet?: boolean }> = [];
  lines.push({ heading: data.language === "EN" ? "RESUME" : "CURRÍCULO", text: resume.headline ?? "" });
  lines.push({ text: resume.summary ?? "" });
  for (const group of resume.skills ?? []) {
    lines.push({ heading: group.category ?? "Skills", text: (group.items ?? []).join(" · ") });
  }
  if (resume.experience?.length) lines.push({ heading: data.language === "EN" ? "PROFESSIONAL EXPERIENCE" : "EXPERIÊNCIA PROFISSIONAL", text: "" });
  for (const job of resume.experience ?? []) {
    lines.push({ heading: `${job.role ?? ""} · ${job.company ?? ""}`, text: job.period ?? "" });
    for (const bullet of job.bullets ?? []) lines.push({ text: bullet, bullet: true });
  }
  if (resume.projects?.length) lines.push({ heading: data.language === "EN" ? "SELECTED PROJECTS" : "PROJETOS SELECIONADOS", text: "" });
  for (const project of resume.projects ?? []) {
    lines.push({ heading: project.name ?? "Project", text: project.description ?? "" });
    if (project.stack?.length) lines.push({ text: (project.stack ?? []).join(" · ") });
  }
  if (resume.education?.length) lines.push({ heading: data.language === "EN" ? "EDUCATION" : "FORMAÇÃO", text: resume.education.join(" · ") });
  if (resume.languages?.length) lines.push({ heading: data.language === "EN" ? "LANGUAGES" : "IDIOMAS", text: resume.languages.join(" · ") });
  lines.push({ heading: data.language === "EN" ? "COVER LETTER" : "CARTA DE APRESENTAÇÃO", text: data.coverLetter });
  return lines;
}

export async function buildApplicationKitDocx(data: ApplicationKitDocumentData): Promise<Buffer> {
  const children = [
    new Paragraph({ text: data.language === "EN" ? "Application Kit" : "Kit de candidatura", heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `${data.jobTitle}${data.company ? ` — ${data.company}` : ""} · v${data.version}`, style: "Subtitle" }),
    ...paragraphsFor(data).map((line) => line.heading
      ? new Paragraph({ text: line.heading, heading: HeadingLevel.HEADING_2 })
      : new Paragraph({ text: line.text, bullet: line.bullet ? { level: 0 } : undefined })),
  ];
  const document = new Document({ sections: [{ properties: {}, children }] });
  return Buffer.from(await Packer.toBuffer(document));
}

function cleanPdfText(value: string): string {
  return value.replace(/[“”]/gu, '"').replace(/[‘’]/gu, "'").replace(/[–—]/gu, "-").replace(/•/gu, "-");
}

export async function buildApplicationKitPdf(data: ApplicationKitDocumentData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  let page = pdf.addPage(pageSize);
  let y = page.getHeight() - 48;
  const maxWidth = page.getWidth() - 96;
  const drawWrapped = (text: string, fontSize: number, isBold = false) => {
    const selectedFont = isBold ? bold : font;
    const words = cleanPdfText(text).split(/\s+/u).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && selectedFont.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        if (y < 54) { page = pdf.addPage(pageSize); y = page.getHeight() - 48; }
        page.drawText(line, { x: 48, y, size: fontSize, font: selectedFont, color: rgb(0.09, 0.12, 0.19) });
        y -= fontSize + 5;
        line = word;
      } else line = candidate;
    }
    if (line) {
      if (y < 54) { page = pdf.addPage(pageSize); y = page.getHeight() - 48; }
      page.drawText(line, { x: 48, y, size: fontSize, font: selectedFont, color: rgb(0.09, 0.12, 0.19) });
      y -= fontSize + 7;
    }
  };
  drawWrapped(data.language === "EN" ? "APPLICATION KIT" : "KIT DE CANDIDATURA", 18, true);
  drawWrapped(`${data.jobTitle}${data.company ? ` - ${data.company}` : ""} | v${data.version}`, 10);
  y -= 12;
  for (const line of paragraphsFor(data)) {
    if (line.heading) {
      if (y < 65) { page = pdf.addPage(pageSize); y = page.getHeight() - 48; }
      y -= 5;
      drawWrapped(line.heading, 11, true);
    }
    if (line.text) drawWrapped(`${line.bullet ? "- " : ""}${line.text}`, 9.5);
  }
  return Buffer.from(await pdf.save());
}

export function kitFilenameStem(jobTitle: string, version: number): string {
  const safe = jobTitle.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48) || "application";
  return `${safe}-application-kit-v${version}`;
}
