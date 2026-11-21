import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ error: "PDF de currículos gerados por IA foi desabilitado. Para respeitar a biblioteca fechada, baixe somente os DOCX importados em /api/career/resumes/library." }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}
