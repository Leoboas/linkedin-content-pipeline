import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { generateResumeDraft, listResumeDrafts } from "@/lib/resume-engine";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  try {
    return NextResponse.json({ drafts: await listResumeDrafts() });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Não foi possível carregar os currículos.", 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonError("JSON inválido.", 400); }
  const targetRole = typeof body.targetRole === "string" ? body.targetRole.trim() : "";
  if (!targetRole) return jsonError("targetRole é obrigatório.", 400);
  try {
    const draft = await generateResumeDraft({
      targetRole,
      template: typeof body.template === "string" ? body.template : undefined,
      jobId: typeof body.jobId === "string" ? body.jobId : undefined,
      feedback: typeof body.feedback === "string" ? body.feedback : undefined,
      draftId: typeof body.draftId === "string" ? body.draftId : undefined,
      sourceText: typeof body.sourceText === "string" ? body.sourceText : undefined,
    });
    return NextResponse.json(draft, { status: 201 });
  } catch (error) {
    console.error("[career/resumes] falha ao gerar currículo", error);
    return jsonError(error instanceof Error ? error.message : "Não foi possível gerar o currículo.", 500);
  }
}
