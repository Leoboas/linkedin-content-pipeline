import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { auditDraft, draftComment, draftReply, extractHookFormula, getEngagementMonitor, humanizeDraft, optimizeProfile } from "@/lib/linkedin-skills-engine";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "profile") return NextResponse.json(await optimizeProfile());
    if (action === "engagement") return NextResponse.json({ items: await getEngagementMonitor() });
    if (action === "hook") return NextResponse.json(extractHookFormula(String(body.title ?? ""), String(body.textContent ?? "")));
    if (action === "humanize") return NextResponse.json(humanizeDraft(String(body.textContent ?? "")));
    if (action === "comment") return NextResponse.json({ text: await draftComment({ postText: String(body.postText ?? ""), angle: typeof body.angle === "string" ? body.angle : undefined }) });
    if (action === "reply") return NextResponse.json({ text: await draftReply({ thread: String(body.thread ?? ""), replyTarget: String(body.replyTarget ?? "") }) });
    if (action === "audit") return NextResponse.json(await auditDraft({
      title: String(body.title ?? ""),
      textContent: String(body.textContent ?? ""),
      editorialPillar: body.editorialPillar === "MOFU" || body.editorialPillar === "BOFU" ? body.editorialPillar : "TOFU",
      slides: Array.isArray(body.slides) ? body.slides as never[] : [],
      imagePrompt: typeof body.imagePrompt === "string" ? body.imagePrompt : null,
      mediaUrl: typeof body.mediaUrl === "string" ? body.mediaUrl : null,
    }));
    return NextResponse.json({ error: "Ação de skill inválida." }, { status: 400 });
  } catch (error) {
    console.error("[linkedin-skills] falha na skill", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao executar skill." }, { status: 502 });
  }
}
