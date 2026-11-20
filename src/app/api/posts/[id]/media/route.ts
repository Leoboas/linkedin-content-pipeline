import { NextResponse } from "next/server";
import { PostStatus, QualityGateStatus, Prisma } from "@prisma/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { prisma } from "@/lib/prisma";
import { uploadPublicAsset } from "@/lib/storage";
import { reviewRenderedImage } from "@/lib/content-reviewer";
import { buildContentBrief } from "@/lib/creative-brief";
import { sendPostForApproval } from "@/lib/telegram";
import { createHash } from "node:crypto";
import { createPostTextVersion, invalidateApprovalForCreativeChange } from "@/lib/post-versioning";
import { recordRenderedCreativeVersion } from "@/lib/content-engine";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const post = await prisma.post.findUnique({ where: { id }, select: { id: true, status: true, title: true, textContent: true, editorialPillar: true, qualityScore: true, qualityStatus: true, qualityReview: true, currentVersionId: true, imagePrompt: true, slidesJson: true, language: true } });
  if (!post) return NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
  if (post.status === PostStatus.PUBLISHED || post.status === PostStatus.PUBLISHING) return NextResponse.json({ error: "Mídia de posts publicados ou em publicação não pode ser alterada." }, { status: 409 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Envie um arquivo de imagem." }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "A mídia precisa ser uma imagem." }, { status: 415 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "A imagem deve ter no máximo 10 MB." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const mediaUrl = await uploadPublicAsset("linkedin-posts/manual-" + id + "-" + file.name, bytes, file.type);
  const visualReview = await reviewRenderedImage({ mediaUrl, title: post.title, editorialPillar: post.editorialPillar, brief: buildContentBrief({ title: post.title, textContent: post.textContent, editorialPillar: post.editorialPillar }) });
  const visualPassed = Boolean(visualReview && visualReview.score >= 72 && visualReview.textLegible);
  const oldReview = post.qualityReview && typeof post.qualityReview === "object" && !Array.isArray(post.qualityReview)
    ? post.qualityReview as Record<string, unknown>
    : {};
  const reviewSnapshot = visualReview
    ? { ...visualReview, status: visualPassed ? "PASS" : "NEEDS_REVISION", reviewedMediaUrl: mediaUrl }
    : { status: "PENDING_HUMAN_REVIEW", reviewedMediaUrl: null, reason: "multimodal image inspection unavailable" };
  const updated = await prisma.$transaction(async (tx) => {
    if (!post.currentVersionId) {
      await createPostTextVersion(tx, { postId: id, snapshot: { title: post.title, textContent: post.textContent, slidesJson: post.slidesJson as Prisma.InputJsonValue | null, imagePrompt: post.imagePrompt, mediaUrl: null, language: post.language }, reason: "captured-before-manual-media-replacement" });
    }
    await invalidateApprovalForCreativeChange(tx, { postId: id, reason: "A mídia do criativo foi substituída no Dashboard." });
    const updateResult = await tx.post.updateMany({ where: { id, status: { notIn: [PostStatus.PUBLISHED, PostStatus.PUBLISHING] } }, data: {
      mediaUrl,
      mediaError: null,
      status: PostStatus.DRAFT,
      approvedCreativeBriefId: null,
      qualityStatus: visualPassed && post.qualityStatus === QualityGateStatus.PASS ? QualityGateStatus.PASS : QualityGateStatus.NEEDS_REVISION,
      qualityScore: Math.min(post.qualityScore ?? 0, visualReview?.score ?? 0),
      qualityReview: { ...oldReview, renderedImage: reviewSnapshot } as unknown as Prisma.InputJsonValue,
      qualityReviewedAt: new Date(),
    } });
    if (!updateResult.count) throw new Error("O post entrou em publicação durante o upload; nenhuma revisão foi aplicada.");
    const asset = await tx.mediaAsset.create({ data: { origin: "DASHBOARD_UPLOAD", storageProvider: "VERCEL_BLOB", storageUrl: mediaUrl, storageKey: new URL(mediaUrl).pathname, sha256, contentType: file.type, byteSize: BigInt(file.size), metadata: { originalName: file.name } }, select: { id: true } });
    const result = await tx.post.findUniqueOrThrow({ where: { id } });
    return { ...result, mediaAssetId: asset.id };
  });
  await recordRenderedCreativeVersion({ postId: id, title: post.title, textContent: post.textContent, editorialPillar: post.editorialPillar, prompt: post.imagePrompt ?? "Manual user upload", mediaUrl, review: reviewSnapshot });
  let telegramCardSent = false;
  if (updated.qualityStatus === QualityGateStatus.PASS) {
    try { await sendPostForApproval(updated); telegramCardSent = true; }
    catch (error) { console.error("[post-media] image reviewed, but Telegram card delivery failed", { postId: id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return NextResponse.json({ id: updated.id, mediaUrl: updated.mediaUrl, status: updated.status, qualityStatus: updated.qualityStatus, visualReview: reviewSnapshot, telegramCardSent });
}
