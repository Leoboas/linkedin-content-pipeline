import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { getKnowledgeSummary } from "@/lib/knowledge-base/importer";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    return NextResponse.json(await getKnowledgeSummary(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[admin/knowledge] falha ao consultar base profissional", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar base profissional." }, { status: 500 });
  }
}
