import { FormatType, PostStatus } from "@prisma/client";
import { predictEngagement } from "@/lib/analytics";
import { generateCreativeImage, regeneratePostWithFeedback } from "@/lib/huggingface";
import { prisma } from "@/lib/prisma";
import { buildRagContext } from "@/lib/rag";
import { sendPostForApproval } from "@/lib/telegram";
import { uploadPublicAsset } from "@/lib/storage";

export async function reformulatePostFromFeedback(postId: string, feedback: string): Promise<void> {
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
    : { dossier: "", examples: [], systemPrompt: "" };
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
  const imagePrompt = [
    `Titulo: ${regenerated.title}`,
    `Mensagem: ${regenerated.textContent.slice(0, 1200)}`,
    regenerated.slides[0] ? `Pontos visuais: ${regenerated.slides[0].bullets.join("; ")}` : "",
    "Criativo profissional para LinkedIn, estilo dark mode, sem texto ilegivel e sem logotipos de terceiros.",
    `Feedback visual do autor: ${feedback}`,
  ].filter(Boolean).join("\n");
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
      slidesJson: regenerated.slides as unknown as object,
      mediaUrl,
      engagementScore: prediction.score,
      engagementLabel: prediction.label,
      status: PostStatus.DRAFT,
    },
  });

  await sendPostForApproval(updated);
}
