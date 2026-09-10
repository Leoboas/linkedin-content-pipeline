import { Prisma, FormatType, PostStatus } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { predictEngagement } from "@/lib/analytics";
import { generateWeeklyPosts as generateWithHuggingFace, regeneratePostWithFeedback, type GeneratedPost, type GeneratedSlide } from "@/lib/huggingface";
import { buildImagePrompt } from "@/lib/image-prompt-engine";
import { generateImageWithFallback } from "@/lib/creative-renderer";
import { prisma } from "@/lib/prisma";
import { buildRagContext, recordRejectionFeedback } from "@/lib/rag";
import { getNextPipelineBaseDate, pillarOrder, scheduledDateForPost } from "@/lib/scheduling";
import { contentFrameworkPrompt } from "../../config/content-skills";

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
  return `${ragSystemPrompt}\n\n===== regras editoriais anti-AI =====\n${HUMAN_COPY_RULES}\n\n===== frameworks B2B de conteúdo =====\n${contentFrameworkPrompt()}`;
}

function deterministicWeeklyPosts(): GeneratedPost[] {
  return [
    {
      editorialPillar: "TOFU",
      funnelStage: "ATTENTION",
      formatType: "CAROUSEL_PDF",
      title: "Seu dashboard responde à pergunta certa, mas no horário errado?",
      textContent: [
        "Quando seu dashboard responde à pergunta certa, mas no horário errado, a decisão já começou a envelhecer?",
        "Esse é um problema de dados antes de ser um problema de visualização.",
        "Quando a carga chega atrasada, o time toma decisões com uma fotografia antiga do negócio. O gráfico pode estar correto e, ainda assim, induzir uma ação ruim.",
        "O primeiro diagnóstico é simples: meça o tempo entre a origem do evento, a transformação e a disponibilidade para quem decide. Depois, separe atraso de processamento, falha de contrato e ausência de observabilidade.",
        "Uma plataforma confiável não promete que nada vai falhar. Ela torna o atraso visível, atribui o impacto e cria um caminho curto para a correção.",
        "Como você mede o custo de decidir com dados atrasados?",
      ].join("\n\n"),
      slides: [
        { title: "O dado chegou tarde", bullets: ["Dashboard correto não significa decisão atualizada", "Tempo de disponibilidade precisa ser medido"] },
        { title: "Onde investigar", bullets: ["Origem do evento", "Transformação e contrato", "Publicação para o consumidor"] },
        { title: "Pergunta prática", bullets: ["Qual decisão muda quando o dado atrasa?", "O impacto tem dono e alerta?"] },
      ],
    },
    {
      editorialPillar: "MOFU",
      funnelStage: "INTEREST",
      formatType: "SINGLE_IMAGE",
      title: "Escalar um pipeline começa pelos contratos, não pelo cluster",
      textContent: [
        "Antes de escalar o cluster, confirme se o contrato do dado consegue escalar com ele.",
        "Mais capacidade computacional não corrige uma entrada instável ou uma regra de negócio ambígua.",
        "Antes de escolher a próxima ferramenta, defina o esquema esperado, a frequência de atualização, a tolerância a atraso e quem responde quando uma premissa muda.",
        "Em seguida, registre qualidade como parte do fluxo: volume recebido, valores nulos, duplicidade, atraso e compatibilidade entre versões. Esses sinais ajudam a separar crescimento saudável de complexidade acumulada.",
        "A arquitetura fica mais simples quando cada etapa tem uma responsabilidade observável. O time consegue discutir trade-offs com evidência, e não com preferência por tecnologia.",
        "Qual contrato do seu pipeline ainda depende de conhecimento informal?",
      ].join("\n\n"),
      slides: [
        { title: "Escala sem contrato", bullets: ["Mais máquinas não definem qualidade", "Entradas instáveis geram retrabalho"] },
        { title: "O mínimo observável", bullets: ["Esquema", "Atraso", "Duplicidade", "Valores nulos"] },
      ],
    },
    {
      editorialPillar: "BOFU",
      funnelStage: "DESIRE",
      formatType: "CAROUSEL_PDF",
      title: "Uma arquitetura de dados madura reduz decisões invisíveis",
      textContent: [
        "Quando a arquitetura explica a origem do número, decisões invisíveis começam a desaparecer.",
        "O ganho não aparece apenas no tempo de execução. Ele aparece quando engenharia, produto e negócio conseguem explicar por que um número mudou.",
        "Uma implementação pragmática começa com camadas bem definidas: dado bruto preservado, transformação auditável e uma camada final orientada ao consumo. O histórico permite reprocessar; os contratos reduzem surpresa; os indicadores mostram o custo operacional.",
        "Com essa base, modelos de machine learning deixam de receber arquivos preparados manualmente e passam a consumir sinais rastreáveis. O time pode avaliar precisão, atraso e custo no mesmo fluxo.",
        "Não é sobre adicionar componentes. É sobre reduzir a distância entre uma mudança na origem e uma decisão explicável.",
        "Qual parte da sua arquitetura ainda não consegue explicar a origem do número?",
      ].join("\n\n"),
      slides: [
        { title: "Dado explicável", bullets: ["Origem preservada", "Transformação auditável", "Consumo com contexto"] },
        { title: "Impacto operacional", bullets: ["Reprocessamento previsível", "Menos decisões invisíveis"] },
        { title: "Próximo passo", bullets: ["Escolha um indicador", "Mapeie sua linhagem", "Meça o custo da mudança"] },
      ],
    },
  ];
}

export async function generateNewPostBatch(options: BatchOptions = {}): Promise<string[]> {
  const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" } });
  if (!editorialLine) throw new Error("Nenhuma EditorialLine cadastrada para orientar a geração.");

  const referenceDate = options.triggeredAt ? new Date(options.triggeredAt) : new Date();
  if (Number.isNaN(referenceDate.getTime())) throw new Error("triggeredAt inválido.");
  const baseDate = getNextPipelineBaseDate(referenceDate);
  const ragContext = await buildRagContext(editorialLine.id);
  let generated: GeneratedPost[];
  try {
    generated = await generateWithHuggingFace({
      themes: editorialLine.themes,
      toneOfVoice: editorialLine.toneOfVoice,
      aidaRules: editorialLine.aidaRules,
      cvCases: editorialLine.cvCases,
      language: editorialLine.language,
    }, { ragSystemPrompt: humanPrompt(ragContext.systemPrompt) });
  } catch (error) {
    console.error("[content-engine] geração de IA indisponível; usando lote editorial determinístico", {
      error: error instanceof Error ? error.message : String(error),
    });
    generated = deterministicWeeklyPosts();
  }

  const weekKey = baseDate.toISOString().slice(0, 10);
  const batchKey = options.batchKey ?? `weekly:${weekKey}`;
  const ids: string[] = [];
  const sortedGenerated = [...generated].sort((left, right) => pillarOrder(left.editorialPillar) - pillarOrder(right.editorialPillar));
  const orderedGenerated = ["TOFU", "MOFU", "BOFU"]
    .map((pillar) => sortedGenerated.find((post) => post.editorialPillar === pillar))
    .filter((post): post is GeneratedPost => Boolean(post));
  for (const post of sortedGenerated) {
    if (orderedGenerated.length >= 3) break;
    if (!orderedGenerated.includes(post)) orderedGenerated.push(post);
  }

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
  console.info("[content-engine] starting post refactor", { postId });
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
  let regenerated: GeneratedPost;
  try {
    regenerated = await regeneratePostWithFeedback({
      oldTitle: current.title,
      oldText: current.textContent,
      feedback,
      editorialPillar: current.editorialPillar,
      funnelStage: current.funnelStage,
      formatType: FormatType.SINGLE_IMAGE,
      ragSystemPrompt: humanPrompt(ragContext.systemPrompt),
    });
  } catch (error) {
    console.error("[content-engine] text refactor failed", {
      postId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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
  let mediaUrl: string;
  try {
    mediaUrl = await generateImageWithFallback({
      postId,
      title: regenerated.title,
      editorialPillar: regenerated.editorialPillar,
      imagePrompt,
    });
  } catch (error) {
    console.error("[content-engine] image refactor failed", {
      postId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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
  console.info("[content-engine] post refactor completed", { postId, mediaUrl: Boolean(mediaUrl) });
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
