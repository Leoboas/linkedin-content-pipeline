import { NextResponse } from "next/server";
import { FormatType, PostStatus, QualityGateStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { reviewPostQuality, reviewRenderedImage } from "@/lib/content-reviewer";
import { validateContentClaims } from "@/lib/claim-validator";

type RouteContext = { params: Promise<{ id: string }> };
type Slide = { title: string; bullets: string[]; code?: string; metrics?: string[] };

function parseSlides(value: Prisma.JsonValue | null): Slide[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, Prisma.JsonValue>;
    if (typeof item.title !== "string") return [];
    return [{
      title: item.title,
      bullets: Array.isArray(item.bullets) ? item.bullets.filter((bullet): bullet is string => typeof bullet === "string") : [],
      ...(typeof item.code === "string" ? { code: item.code } : {}),
      ...(Array.isArray(item.metrics) ? { metrics: item.metrics.filter((metric): metric is string => typeof metric === "string") } : {}),
    }];
  });
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const post = await prisma.post.findUnique({
    where: { id },
    select: { id: true, status: true, title: true, textContent: true, editorialPillar: true, formatType: true, slidesJson: true, imagePrompt: true, mediaUrl: true, qualityReview: true, currentVersionId: true, editorialLineId: true, updatedAt: true, creativeBriefs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, postVersionId: true, contentBrief: true, visualBrief: true, evidenceSnapshot: true, effectivePrompt: true, mediaUrl: true } } },
  });
  if (!post) return NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
  if (post.status === PostStatus.PUBLISHED || post.status === PostStatus.PUBLISHING) return NextResponse.json({ error: "Posts publicados ou em publicação não podem ser reavaliados nesta tela." }, { status: 409 });

  const creative = post.creativeBriefs[0];
  const versionMatches = !post.currentVersionId || !creative?.postVersionId || creative.postVersionId === post.currentVersionId;
  const contentBrief = versionMatches ? creative?.contentBrief : null;
  const startedAt = Date.now();
  try {
    const [editorialReview, claims] = await Promise.all([
      reviewPostQuality({ title: post.title, textContent: post.textContent, editorialPillar: post.editorialPillar, slides: parseSlides(post.slidesJson), imagePrompt: post.imagePrompt, mediaUrl: post.mediaUrl, contentBrief }),
      validateContentClaims({ title: post.title, textContent: post.textContent, editorialLineId: post.editorialLineId ?? undefined }),
    ]);
    const visualRequired = post.formatType !== FormatType.TEXT_ONLY;
    const visualReview = visualRequired && post.mediaUrl
      ? await reviewRenderedImage({ mediaUrl: post.mediaUrl, title: post.title, editorialPillar: post.editorialPillar, brief: versionMatches ? creative?.visualBrief ?? contentBrief : null })
      : null;
    const visualPending = visualRequired && (!post.mediaUrl || !visualReview);
    const qualityStatus = claims.blocked
      ? QualityGateStatus.BLOCKED
      : editorialReview.evaluation.method !== "AI" || editorialReview.status !== QualityGateStatus.PASS || (visualRequired && (!visualReview || visualReview.score < 72 || !visualReview.textLegible))
        ? QualityGateStatus.NEEDS_REVISION
        : QualityGateStatus.PASS;
    const qualityScore = visualPending
      ? null
      : Math.min(editorialReview.score, claims.score, ...(visualReview ? [visualReview.score] : []));
    const review = {
      ...editorialReview,
      status: qualityStatus,
      evaluation: {
        ...editorialReview.evaluation,
        status: "COMPLETED",
        evaluatedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        contentVersionId: post.currentVersionId,
        creativeBriefId: versionMatches ? creative?.id ?? null : null,
      },
      claims,
      renderedImage: !visualRequired
        ? { status: "NOT_REQUIRED", reviewedMediaUrl: null }
        : visualReview
          ? { ...visualReview, status: qualityStatus === QualityGateStatus.PASS ? "PASS" : "NEEDS_REVISION", reviewedMediaUrl: post.mediaUrl }
          : { status: "PENDING_HUMAN_REVIEW", reviewedMediaUrl: null, reason: "A inspeção multimodal da imagem não foi concluída." },
      recommendations: [...editorialReview.recommendations, ...claims.unsupportedClaims.map((claim) => `Afirmação sem evidência: ${claim}`), ...(visualPending ? ["A imagem precisa de inspeção multimodal ou revisão humana antes de aprovação."] : [])],
      summary: claims.blocked ? "Bloqueado: foram encontradas afirmações sem evidência." : visualPending ? "Texto avaliado; revisão da imagem pendente. O quality gate permanece fechado." : editorialReview.summary,
    };
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.post.updateMany({
        where: { id, updatedAt: post.updatedAt, currentVersionId: post.currentVersionId },
        data: { qualityStatus, qualityScore, qualityReview: review as unknown as Prisma.InputJsonValue, qualityReviewedAt: new Date(), approvedCreativeBriefId: null, status: PostStatus.DRAFT },
      });
      if (changed.count !== 1) throw new Error("O post foi alterado durante a avaliação. Atualize a página e tente novamente.");
      if (versionMatches && creative) {
        await tx.creativeBrief.update({ where: { id: creative.id }, data: {
          reviewStatus: qualityStatus,
          aestheticScore: visualReview?.aestheticScore ?? null,
          semanticScore: visualReview?.semanticScore ?? null,
          technicalScore: visualReview?.technicalScore ?? null,
          reviewSnapshot: review as unknown as Prisma.InputJsonValue,
        } });
      }
      return tx.post.findUniqueOrThrow({ where: { id }, select: { qualityStatus: true, qualityScore: true, qualityReview: true, updatedAt: true } });
    });
    return NextResponse.json({ ok: true, post: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida na avaliação.";
    console.error("[post-review] avaliação falhou", { postId: id, versionId: post.currentVersionId, elapsedMs: Date.now() - startedAt, error: message });
    await prisma.post.updateMany({ where: { id, updatedAt: post.updatedAt, currentVersionId: post.currentVersionId }, data: {
      qualityStatus: QualityGateStatus.NEEDS_REVISION,
      qualityScore: null,
      approvedCreativeBriefId: null,
      qualityReview: { evaluation: { status: "FAILED", method: null, evaluatedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt, contentVersionId: post.currentVersionId, error: message } },
    } });
    return NextResponse.json({ error: message, evaluationStatus: "FAILED" }, { status: 500 });
  }
}
