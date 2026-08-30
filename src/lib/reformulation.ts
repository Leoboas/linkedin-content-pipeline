import { FormatType, PostStatus } from "@prisma/client";
import { predictEngagement } from "@/lib/analytics";
import { generateCreativeImage, regeneratePostWithFeedback } from "@/lib/huggingface";
import { buildImagePrompt } from "@/lib/image-prompt-engine";
import { prisma } from "@/lib/prisma";
import { buildRagContext } from "@/lib/rag";
import { sendPostForApproval } from "@/lib/telegram";
import { uploadPublicAsset } from "@/lib/storage";

export async function reformulatePostFromFeedback(
  postId: string,
  feedback: string,
  options: { sendTelegram?: boolean } = {},
): Promise<void> {
  const current = await prisma.post.findUnique({ where: { id: postId } });
  if (!current) throw new Error("Post associado ao feedback nao encontrado.");
  const reformulableStatuses = new Set<PostStatus>([
    PostStatus.REJECTED,
    PostStatus.REJECTED_PENDING_FEEDBACK,
    PostStatus.REGENERATING,
    PostStatus.AWAITING_APPROVAL,
    PostStatus.DRAFT,
  ]);
  if (!reformulableStatuses.has(current.status)) {
    throw new Error("Somente posts rejeitados ou em rascunho podem ser reformulados.");
  }

  const ragContext = current.editorialLineId
    ? await buildRagContext(current.editorialLineId)
    : { dossier: "", examples: [], latestPublished: null, negativeFeedback: [], references: "", systemPrompt: "" };
  const regenerated = await regeneratePostWithFeedback({
    oldTitle: current.title,
    oldText: current.textContent,
    feedback,
    editorialPillar: current.editorialPillar,
    ragSystemPrompt: ragContext.systemPrompt,
  });
  const prediction = predictEngagement({
    title: regenerated.title,
    textContent: regenerated.textContent,
    editorialPillar: regenerated.editorialPillar,
    dossier: ragContext.dossier,
    ragExamples: ragContext.examples,
  });
  const imagePrompt = buildImagePrompt({
    title: regenerated.title,
    textContent: regenerated.textContent,
    editorialPillar: regenerated.editorialPillar,
    visualBullets: regenerated.slides[0]?.bullets,
    feedback,
    negativeFeedback: ragContext.negativeFeedback,
  });
  const image = await generateCreativeImage(imagePrompt);
  const mediaUrl = await uploadPublicAsset(
    `linkedin-posts/${postId}-${encodeURIComponent(regenerated.title)}.png`,
    image,
    "image/png",
  );
  const updated = await prisma.post.update({
    where: { id: postId },
    data: {
      title: regenerated.title,
      textContent: regenerated.textContent,
      editorialPillar: regenerated.editorialPillar,
      funnelStage: regenerated.funnelStage,
      formatType: FormatType.SINGLE_IMAGE,
      imagePrompt,
      slidesJson: regenerated.slides as unknown as object,
      mediaUrl,
      engagementScore: prediction.score,
      engagementLabel: prediction.label,
      feedbackText: feedback,
      status: PostStatus.DRAFT,
    },
  });

  if (options.sendTelegram !== false) {
    await sendPostForApproval(updated);
  }
}
