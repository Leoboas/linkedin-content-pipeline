import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { JobDescriptionUnavailableError, matchInboundJob } from "@/lib/job-matcher";

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return errorResponse("Não autorizado.", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("Envie um corpo JSON válido.", 400);
  }

  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : undefined;

  if (!url && description.length < 240) {
    return errorResponse("Informe uma URL de vaga ou cole pelo menos 240 caracteres da descrição completa.", 400);
  }

  try {
    const analysis = await matchInboundJob({ url: url || undefined, subject, body: description });
    return NextResponse.json(analysis, { status: 201 });
  } catch (error) {
    if (error instanceof JobDescriptionUnavailableError) {
      return NextResponse.json({
        error: url
          ? "O LinkedIn bloqueou a leitura automática desse link. Copie a descrição completa da vaga e envie no campo de descrição."
          : error.message,
        blocked: Boolean(url),
      }, { status: 422 });
    }

    console.error("[Career Match API] Falha ao analisar vaga", error);
    return errorResponse(error instanceof Error ? error.message : "Falha interna ao analisar a vaga.", 500);
  }
}
