import { Prisma, FormatType, PostStatus } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { predictEngagement } from "@/lib/analytics";
import { generateWeeklyPosts as generateWithHuggingFace, regeneratePostWithFeedback, type GeneratedSlide } from "@/lib/huggingface";
import { buildImagePrompt } from "@/lib/image-prompt-engine";
import { generateSingleImageAsset } from "@/lib/creative-renderer";
import { prisma } from "@/lib/prisma";
import { buildRagContext, recordRejectionFeedback } from "@/lib/rag";
import { getNextPipelineBaseDate, pillarOrder, scheduledDateForPost } from "@/lib/scheduling";

export const HUMAN_COPY_RULES = [
  "Escreva como um engenheiro ou líder de dados que viveu o problema na prática, não como um redator genérico.",
  "Use português do Brasil correto, com concordância, ortografia e pontuação revisadas.",
  "Prefira parágrafos curtos e fluidos, com storytelling direto, gancho forte sem sensacionalismo e uma ideia central por parágrafo.",
  "É proibido usar: no mundo dinâmico de hoje, revolucionário, desvendar, desbloquear, mergulhar e alavancar.",
  "Não use listas corridas para substituir explicação. Evite excesso de hífens, travessões, emojis e frases com estrutura repetitiva.",
  "Não invente métricas, clientes, cargos, resultados ou detalhes que não estejam no dossier ou nas referências autorizadas.",
].join(" ");

interface BatchOptions {
  triggeredAt?: string;
  batchKey?: string;
}

function humanPrompt(ragSystemPrompt: string): string {
  return `${ragSystemPrompt}\n\n===== regras editoriais anti-AI =====\n${HUMAN_COPY_RULES}`;
}

export async function generateNewPostBatch(options: BatchOptions = {}): Promise<string[]> {
  const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" } });
  if (!editorialLine) throw new Error("Nenhuma EditorialLine cadastrada para orientar a geração.");

  const referenceDate = options.triggeredAt ? new Date(options.triggeredAt) : new Date();
  if (Number.isNaN(referenceDate.getTime())) throw new Error("triggeredAt inválido.");
  const baseDate = getNextPipelineBaseDate(referenceDate);
  const ragContext = await buildRagContext(editorialLine.id);
  const generated = await generateWithHuggingFace({
    themes: editorialLine.themes,
    toneOfVoice: editorialLine.toneOfVoice,
    aidaRules: editorialLine.aidaRules,
    cvCases: editorialLine.cvCases,
    language: editorialLine.language,
  }, { ragSystemPrompt: humanPrompt(ragContext.systemPrompt) });

  const weekKey = baseDate.toISOString().slice(0, 10);
  const batchKey = options.batchKey ?? `weekly:${weekKey}`;
  const ids: string[] = [];
  const orderedGenerated = [...generated].sort((left, right) => pillarOrder(left.editorialPillar) - pillarOrder(right.editorialPillar));

  for (const [index, post] of orderedGenerated.entries()) {
    const generationKey = `${batchKey}:${index}`;
    const existing = await prisma.post.findUnique({ where: { generationKey } });
    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const prediction = predictEngagement({
      title: post.title,
      textContent: post.textContent,
      editorialPillar: post.editorialPillar,
      dossier: ragContext.dossier,
      ragExamples: ragContext.examples,
    });
    const imagePrompt = buildImagePrompt({
      title: post.title,
      textContent: post.textContent,
      editorialPillar: post.editorialPillar,
      visualBullets: post.slides[0]?.bullets,
      negativeFeedback: ragContext.negativeFeedback,
      referenceInsights: ragContext.references,
    });
    const scheduledDate = scheduledDateForPost(index, post.editorialPillar, baseDate);
    const saved = await prisma.post.create({
      data: {
        generationKey,
        editorialLineId: editorialLine.id,
        editorialPillar: post.editorialPillar,
        funnelStage: post.funnelStage,
        formatType: post.formatType,
        title: post.title,
        textContent: post.textContent,
        imagePrompt,
        slidesJson: post.slides as unknown as Prisma.InputJsonValue,
        engagementScore: prediction.score,
        engagementLabel: prediction.label,
        status: PostStatus.AWAITING_APPROVAL,
        scheduledFor: scheduledDate,
        scheduledDate,
      },
    });
    ids.push(saved.id);
  }
  return ids;
}

export async function refactorPostWithFeedback(
  postId: string,
  userFeedback: string,
  options: { sendTelegram?: boolean } = {},
): Promise<void> {
  const current = await prisma.post.findUnique({ where: { id: postId } });
  if (!current) throw new Error("Post associado ao feedback não encontrado.");
  const reformulableStatuses = new Set<PostStatus>([
    PostStatus.REJECTED, PostStatus.REJECTED_PENDING_FEEDBACK, PostStatus.REGENERATING,
    PostStatus.AWAITING_APPROVAL, PostStatus.DRAFT, PostStatus.APPROVED, PostStatus.SCHEDULED,
  ]);
  if (!reformulableStatuses.has(current.status)) throw new Error("Este post não pode ser reformulado.");

  const feedback = userFeedback.trim();
  if (!feedback) throw new Error("Feedback vazio.");
  const ragContext = current.editorialLineId
    ? await buildRagContext(current.editorialLineId)
    : { dossier: "", examples: [], latestPublished: null, negativeFeedback: [], references: "", systemPrompt: "" };
  const regenerated = await regeneratePostWithFeedback({
    oldTitle: current.title,
    oldText: current.textContent,
    feedback,
    editorialPillar: current.editorialPillar,
    funnelStage: current.funnelStage,
    formatType: FormatType.SINGLE_IMAGE,
    ragSystemPrompt: humanPrompt(ragContext.systemPrompt),
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
    referenceInsights: ragContext.references,
  });
  const mediaUrl = await generateSingleImageAsset({
    postId,
    title: regenerated.title,
    editorialPillar: regenerated.editorialPillar,
    imagePrompt,
  });
  const updated = await prisma.post.update({
    where: { id: postId },
    data: {
      title: regenerated.title,
      textContent: regenerated.textContent,
      editorialPillar: regenerated.editorialPillar,
      funnelStage: regenerated.funnelStage,
      formatType: FormatType.SINGLE_IMAGE,
      imagePrompt,
      slidesJson: regenerated.slides as unknown as Prisma.InputJsonValue,
      mediaUrl,
      engagementScore: prediction.score,
      engagementLabel: prediction.label,
      feedbackText: feedback,
      status: PostStatus.DRAFT,
    },
  });
  if (options.sendTelegram !== false) {
    const { sendPostForApproval } = await import("@/lib/telegram");
    await sendPostForApproval(updated);
  }
}

const queueableStatuses = new Set<PostStatus>([
  PostStatus.DRAFT, PostStatus.AWAITING_APPROVAL, PostStatus.APPROVED,
  PostStatus.SCHEDULED, PostStatus.REJECTED, PostStatus.REJECTED_PENDING_FEEDBACK,
]);

export async function requestPostRefactor(
  postId: string,
  userFeedback: string,
  options: { recordFeedback?: boolean } = {},
): Promise<{ queued: true; alreadyQueued?: boolean }> {
  const feedback = userFeedback.trim();
  if (feedback.length < 5) throw new Error("Descreva uma melhoria com pelo menos cinco caracteres.");
  const current = await prisma.post.findUnique({ where: { id: postId }, select: { status: true, updatedAt: true } });
  if (!current) throw new Error("Post não encontrado.");
  if (current.status === PostStatus.REGENERATING && Date.now() - current.updatedAt.getTime() > 10 * 60 * 1000) {
    await prisma.post.updateMany({ where: { id: postId, status: PostStatus.REGENERATING }, data: { status: PostStatus.REJECTED_PENDING_FEEDBACK } });
    current.status = PostStatus.REJECTED_PENDING_FEEDBACK;
  }
  if (!queueableStatuses.has(current.status)) {
    if (current.status === PostStatus.REGENERATING) return { queued: true, alreadyQueued: true };
    throw new Error("Este post não está disponível para reformulação.");
  }
  const locked = await prisma.post.updateMany({
    where: { id: postId, status: current.status },
    data: { status: PostStatus.REGENERATING, feedbackText: feedback },
  });
  if (locked.count === 0) return { queued: true, alreadyQueued: true };
  try {
    if (options.recordFeedback) await recordRejectionFeedback(postId, feedback);
    await inngest.send({ name: "posts/reformulate.requested", data: { postId, feedback } });
  } catch (error) {
    await prisma.post.updateMany({ where: { id: postId, status: PostStatus.REGENERATING }, data: { status: current.status } });
    throw error;
  }
  return { queued: true };
}

export async function requestPostPublication(postId: string): Promise<void> {
  if (!postId) throw new Error("Post sem identificador para publicação.");
  await inngest.send({ name: "posts/publish.requested", data: { postId } });
}
