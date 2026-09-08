import { NextResponse } from "next/server";
import { auditLinkedInProfile } from "@/lib/profile-auditor";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    return NextResponse.json(await auditLinkedInProfile());
  } catch (error) {
    console.error("Falha na auditoria de mercado do LinkedIn:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao auditar o perfil." }, { status: 502 });
  }
}
