import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { getOrCreateProfile } from "@/lib/career-engine";
import { getResumeMetadataByName } from "../../../../../../config/authorized-resumes";

export const runtime = "nodejs";
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const profile = await getOrCreateProfile();
    const resumes = await prisma.authorizedResume.findMany({ where: { profileId: profile.id }, select: { id: true, resumeKey: true, originalName: true, profileType: true, language: true, version: true, sha256: true, byteSize: true, authorizedAt: true, updatedAt: true }, orderBy: { originalName: "asc" } });
    return NextResponse.json({ resumes });
  } catch {
    return NextResponse.json({ error: "Biblioteca indisponível. A migration aditiva de Career ainda precisa ser aplicada no ambiente isolado." }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Envie um arquivo DOCX válido no campo file." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo não recebido." }, { status: 400 });
  const metadata = getResumeMetadataByName(file.name);
  if (!metadata) return NextResponse.json({ error: "Somente os quatro arquivos DOCX previamente autorizados podem ser importados." }, { status: 400 });
  if (file.size <= 4 || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "O arquivo deve ter até 4 MB." }, { status: 413 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return NextResponse.json({ error: "O arquivo não parece ser um DOCX válido." }, { status: 400 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    const profile = await getOrCreateProfile();
    const resume = await prisma.authorizedResume.upsert({
      where: { resumeKey: metadata.resumeKey },
      create: { profileId: profile.id, resumeKey: metadata.resumeKey, originalName: metadata.originalName, profileType: metadata.profileType, language: metadata.language, version: metadata.version, sha256, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteSize: bytes.byteLength, fileData: bytes },
      update: { profileId: profile.id, sha256, byteSize: bytes.byteLength, fileData: bytes, authorizedAt: new Date() },
      select: { id: true, resumeKey: true, originalName: true, profileType: true, language: true, version: true, sha256: true, byteSize: true, updatedAt: true },
    });
    return NextResponse.json({ resume }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Importação indisponível. Confirme primeiro a migration de Career no banco de desenvolvimento." }, { status: 503 });
  }
}
