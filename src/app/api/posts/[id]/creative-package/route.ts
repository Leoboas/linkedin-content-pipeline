import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { buildContentBrief, toVisualBrief } from "@/lib/creative-brief";
import { getVisualProjectEvidenceDetails } from "@/lib/editorial-planner";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const { id } = await context.params;
    const post = await prisma.post.findUnique({
      where: { id },
      select: { id: true, title: true, textContent: true, imagePrompt: true, mediaUrl: true, editorialPillar: true, formatType: true, language: true, associatedProject: true, currentVersionId: true, slidesJson: true, creativeBriefs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, version: true, postVersionId: true, thesis: true, technicalConflict: true, concreteProblem: true, visualConcept: true, shortOverlayTitle: true, evidenceSnapshot: true, effectivePrompt: true, mediaUrl: true, contentBrief: true, visualBrief: true, reviewSnapshot: true, reviewStatus: true, aestheticScore: true, semanticScore: true, technicalScore: true } } },
    });
    if (!post) return NextResponse.json({ error: "Post não encontrado." }, { status: 404 });

    const evidence = await getVisualProjectEvidenceDetails(`${post.title} ${post.textContent}`);
    const persisted = post.creativeBriefs[0];
    const creativeMatchesVersion = Boolean(persisted && (!post.currentVersionId || persisted.postVersionId === post.currentVersionId));
    const brief = creativeMatchesVersion && persisted?.contentBrief && typeof persisted.contentBrief === "object"
      ? persisted.contentBrief as unknown as ReturnType<typeof buildContentBrief>
      : buildContentBrief({ title: post.title, textContent: post.textContent, editorialPillar: post.editorialPillar, projectEvidence: evidence });
    const visualBrief = creativeMatchesVersion && persisted?.visualBrief && typeof persisted.visualBrief === "object"
      ? persisted.visualBrief
      : toVisualBrief(brief, (() => {
          const slides = Array.isArray(post.slidesJson) ? post.slidesJson : [];
          const first = slides[0];
          return first && typeof first === "object" && !Array.isArray(first) && Array.isArray((first as Record<string, unknown>).bullets)
            ? ((first as Record<string, unknown>).bullets as unknown[]).filter((item): item is string => typeof item === "string")
            : [];
        })());
    const effectivePrompt = creativeMatchesVersion ? persisted?.effectivePrompt ?? post.imagePrompt : post.imagePrompt;
    const chatGptPrompt = [
      "Create a premium LinkedIn visual based on the following verified creative brief.",
      "Preserve the technical meaning; do not invent components, metrics, products, or outcomes.",
      "Use a clean editorial composition and leave a safe, high-contrast area for the exact overlay title provided below.",
      "Do not render any other text, logos, labels, or watermarks.",
      `Language: ${post.language}. Format: ${post.formatType}. Pillar: ${post.editorialPillar}.`,
      `Exact overlay title (typeset separately; preserve spelling): ${creativeMatchesVersion ? persisted?.shortOverlayTitle ?? brief.shortOverlayTitle : brief.shortOverlayTitle}`,
      `Visual brief JSON: ${JSON.stringify(visualBrief)}`,
      effectivePrompt ? `Persisted image direction for this version: ${effectivePrompt}` : "",
    ].filter(Boolean).join("\n\n");
    const markdown = [
      `# ${post.title}`,
      `Language: ${post.language} | Pillar: ${post.editorialPillar} | Format: ${post.formatType}`,
      `Creative brief: ${creativeMatchesVersion ? `v${persisted?.version} (persistido para a versão atual)` : "briefing reconstruído para revisão; histórico original indisponível"}`,
      post.associatedProject ? `Associated project: ${post.associatedProject}` : "No project association is asserted.",
      "",
      "## LinkedIn caption",
      post.textContent,
      "",
      "## Verified evidence available",
      evidence.length ? evidence.map((item) => `- [${item.kind}] ${item.claim} (source: ${item.source ?? item.id ?? "not specified"})`).join("\n") : "- No matching verified project evidence found. Keep project-specific claims out of the copy.",
      "",
      "## Content thesis and visual brief",
      JSON.stringify({ thesis: brief.thesis, concreteProblem: brief.concreteProblem, technicalConflict: brief.technicalConflict, visualConcept: brief.visualConcept, overlayTitle: brief.shortOverlayTitle, visualBrief }, null, 2),
      "",
      "## Prompt for ChatGPT image creation",
      chatGptPrompt,
      post.mediaUrl ? `\n## Current creative\n${creativeMatchesVersion && persisted?.mediaUrl ? persisted.mediaUrl : post.mediaUrl}` : "",
    ].filter(Boolean).join("\n");

    return NextResponse.json({ postId: post.id, language: post.language, formatType: post.formatType, caption: post.textContent, evidence, brief, visualBrief, chatGptPrompt, markdown, mediaUrl: creativeMatchesVersion && persisted?.mediaUrl ? persisted.mediaUrl : post.mediaUrl, creativeBriefId: creativeMatchesVersion ? persisted?.id ?? null : null, creativeBriefVersion: creativeMatchesVersion ? persisted?.version ?? null : null, creativeBriefMatchesCurrentVersion: creativeMatchesVersion, persistedEffectivePrompt: creativeMatchesVersion ? persisted?.effectivePrompt ?? null : null, review: creativeMatchesVersion ? { status: persisted?.reviewStatus, snapshot: persisted?.reviewSnapshot, aestheticScore: persisted?.aestheticScore, semanticScore: persisted?.semanticScore, technicalScore: persisted?.technicalScore } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[creative-package] failed", error);
    return NextResponse.json({ error: "Não foi possível montar o pacote criativo." }, { status: 500 });
  }
}
