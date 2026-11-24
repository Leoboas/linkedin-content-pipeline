import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { getOrCreateProfile } from "@/lib/career-engine";
import { getResumeMetadataByName } from "../../../../../../config/authorized-resumes";
import { extractResumeText } from "@/lib/resume-document-extractor";
import { authorizedResumeStorageKey, authorizedResumeVersion } from "@/lib/authorized-resume-versioning";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
// Keep uploads below the serverless request-body ceiling; larger documents should
// use private direct-to-object-storage upload instead of failing at runtime.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const profile = await getOrCreateProfile();
    const records = await prisma.authorizedResume.findMany({
      where: { profileId: profile.id },
      select: { id: true, resumeKey: true, originalName: true, profileType: true, language: true, version: true, sha256: true, byteSize: true, authorizedAt: true, createdAt: true, updatedAt: true },
      orderBy: [{ originalName: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ resumes: records.map((resume) => ({ ...resume, referenceOnly: resume.resumeKey.startsWith("reference-") })) });
  } catch {
    return NextResponse.json({ error: "Biblioteca privada indisponível." }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Envie o arquivo autorizado no campo file." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo não recebido." }, { status: 400 });
  const metadata = getResumeMetadataByName(file.name);
  if (!metadata) return NextResponse.json({ error: "Importe uma das quatro versões V2 ou um dos dois PDFs de referência previamente selecionados." }, { status: 400 });
  if (file.size <= 4 || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "O arquivo deve ter até 4 MB." }, { status: 413 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  const isDocx = file.name.toLowerCase().endsWith(".docx");
  const validPdf = isPdf && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  const validDocx = isDocx && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!validPdf && !validDocx) return NextResponse.json({ error: "Assinatura do arquivo incompatível com DOCX ou PDF." }, { status: 415 });
  const contentType = isPdf ? "application/pdf" : DOCX_MIME;
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  try {
    const profile = await getOrCreateProfile();
    const extractedText = await extractResumeText(bytes, contentType);
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.authorizedResume.findFirst({
        where: { profileId: profile.id, sha256 },
        select: { id: true, resumeKey: true, originalName: true, profileType: true, language: true, version: true, sha256: true, byteSize: true, updatedAt: true },
      });
      if (duplicate) return { resume: duplicate, duplicate: true };

      const canonical = await tx.authorizedResume.findUnique({ where: { resumeKey: metadata.resumeKey }, select: { id: true } });
      const resumeKey = authorizedResumeStorageKey(metadata.resumeKey, sha256, Boolean(canonical));
      const version = authorizedResumeVersion(metadata.version, sha256, Boolean(canonical));
      const resume = await tx.authorizedResume.create({
        data: { profileId: profile.id, resumeKey, originalName: metadata.originalName, profileType: metadata.profileType, language: metadata.language, version, sha256, contentType, byteSize: bytes.byteLength, fileData: bytes },
        select: { id: true, resumeKey: true, originalName: true, profileType: true, language: true, version: true, sha256: true, byteSize: true, updatedAt: true },
      });
      const sourceUrl = `authorized-resume://${profile.id}/${resumeKey}`;
      const existingDocument = await tx.careerDocument.findFirst({ where: { profileId: profile.id, sourceUrl }, select: { id: true } });
      const title = `Currículo autorizado: ${metadata.title} (${version})`;
      if (existingDocument) await tx.careerDocument.update({ where: { id: existingDocument.id }, data: { title, content: extractedText } });
      else await tx.careerDocument.create({ data: { profileId: profile.id, title, content: extractedText, sourceUrl } });
      return { resume, duplicate: false };
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const profile = await getOrCreateProfile();
      const duplicate = await prisma.authorizedResume.findFirst({ where: { profileId: profile.id, sha256 }, select: { id: true, resumeKey: true, originalName: true, profileType: true, language: true, version: true, sha256: true, byteSize: true, updatedAt: true } });
      if (duplicate) return NextResponse.json({ resume: duplicate, duplicate: true }, { status: 200 });
    }
    const message = error instanceof Error && /extract text|extract|protected|scanned|texto suficiente|protegido|digitalizada|Formato de curr/i.test(error.message)
      ? error.message
      : "Importação privada indisponível; o arquivo não foi registrado. Confira o formato e a conexão do Career CRM.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
