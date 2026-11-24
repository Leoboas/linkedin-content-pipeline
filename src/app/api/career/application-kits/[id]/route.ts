import { NextResponse } from "next/server";
import { getOrCreateProfile } from "@/lib/career-engine";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { approveApplicationKit, reviseApplicationKit } from "@/lib/career-application-kit";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const profile = await getOrCreateProfile();
  try {
    if (body.action === "approve") {
      const kit = await approveApplicationKit(id, profile.id);
      return NextResponse.json({ kit });
    }
    if (body.action === "revise") {
      if (body.coverLetter !== undefined && typeof body.coverLetter !== "string") return NextResponse.json({ error: "coverLetter deve ser texto." }, { status: 400 });
      const kit = await reviseApplicationKit({ kitId: id, profileId: profile.id, coverLetter: body.coverLetter as string | undefined, tailoredResume: body.tailoredResume });
      return NextResponse.json({ kit }, { status: 201 });
    }
    return NextResponse.json({ error: "Ação deve ser revise ou approve." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o Application Kit.";
    return NextResponse.json({ error: message }, { status: message.includes("não encontrado") ? 404 : 409 });
  }
}
