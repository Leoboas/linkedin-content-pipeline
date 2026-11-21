import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  return jsonError("Rascunhos antigos gerados por IA foram preservados no banco, mas não são tratados como documentos autorizados. Use a biblioteca privada de quatro currículos.", 410);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  return jsonError("A geração de currículos foi desabilitada para respeitar a biblioteca fechada de quatro documentos autorizados. Importe os arquivos originais em /career antes de preparar candidaturas.", 409);
}
