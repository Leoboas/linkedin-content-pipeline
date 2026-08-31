import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { requestPostRefactor } from "@/lib/content-engine";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) {
    return NextResponse.json({ error: "Configure o DASHBOARD_ADMIN_TOKEN para regenerar o post." }, { status: 401 });
  }
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "ID de post inválido." }, { status: 400 });

  let body: { feedback?: unknown };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400 }); }
  if (typeof body.feedback !== "string" || body.feedback.trim().length < 5) {
    return NextResponse.json({ error: "Descreva pelo menos uma melhoria desejada." }, { status: 400 });
  }
  try {
    const result = await requestPostRefactor(id, body.feedback, { recordFeedback: false });
    return NextResponse.json({ ...result, status: "REGENERATING" }, { status: 202 });
  } catch (error) {
    console.error("Falha ao enfileirar regeneração do dashboard:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível iniciar a regeneração." }, { status: 502 });
  }
}
