import { ImplementationStatus, KnowledgeEvidenceStatus, KnowledgeTrustLevel, KnowledgeVisibility, Prisma, FormatType, PostStatus, QualityGateStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { inngest } from "@/inngest/client";
import { predictEngagement } from "@/lib/analytics";
import { generateWeeklyPosts as generateWithHuggingFace, regeneratePostWithFeedback, type GeneratedPost, type GeneratedSlide } from "@/lib/huggingface";
import { buildImagePrompt } from "@/lib/image-prompt-engine";
import { generateImageWithFallback } from "@/lib/creative-renderer";
import { qualityReviewJson, reviewPostQuality, reviewRenderedImage } from "@/lib/content-reviewer";
import { prisma } from "@/lib/prisma";
import { buildRagContext, recordRejectionFeedback } from "@/lib/rag";
import { validateContentClaims } from "@/lib/claim-validator";
import { getProfessionalEvidenceDetails, getVisualProjectEvidenceDetails } from "@/lib/editorial-planner";
import { buildContentBrief } from "@/lib/creative-brief";
import { toVisualBrief } from "@/lib/creative-brief";
import { createPostTextVersion } from "@/lib/post-versioning";
import { getAvailableWeeklySlots, hasDuplicatePostTitle } from "@/lib/post-generation-guard";
import type { ContentLanguage } from "@/lib/language-planner";
import { normalizeWeeklySchedule } from "@/lib/editorial-calendar";
import { classifyEditorialTheme, evaluateHookQuality, scoreCareerRelevance, selectEditorialFormat } from "@/lib/editorial-intelligence";
import { getNextPipelineBaseDate, rollingScheduledDateForPost, scheduledDateForPost } from "@/lib/scheduling";
import { contentFrameworkPrompt } from "../../config/content-skills";
import { positioningPrompt } from "../../config/linkedin-positioning";
import { CREATIVE_DIRECTION_PROMPT, visualFormatForPost } from "../../config/creative-direction";

export const HUMAN_COPY_RULES = [
  "Escreva como um engenheiro ou líder de dados que viveu o problema na prática, não como um redator genérico.",
  "Use português do Brasil correto, com concordância, ortografia e pontuação revisadas.",
  "Prefira parágrafos curtos e fluidos, com storytelling direto, gancho forte sem sensacionalismo e uma ideia central por parágrafo.",
  "É proibido usar: no mundo dinâmico de hoje, revolucionário, desvendar, desbloquear, mergulhar e alavancar.",
  "Não use listas corridas para substituir explicação. Evite excesso de hífens, travessões, emojis e frases com estrutura repetitiva.",
  "Não invente métricas, clientes, cargos, resultados ou detalhes que não estejam no dossier ou nas referências autorizadas.",
].join(" ");

async function loadStoredMediaForVersion(mediaUrl: string | null | undefined): Promise<null | { url: string; storageKey: string; sha256: string; contentType: string; bytes: Uint8Array }> {
  if (!mediaUrl) return null;
  const url = new URL(mediaUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".public.blob.vercel-storage.com")) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Não foi possível versionar a mídia do Blob (HTTP ${response.status}).`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "application/octet-stream";
  if (!contentType.startsWith("image/") && contentType !== "application/pdf") throw new Error(`Tipo de mídia não suportado no histórico criativo: ${contentType}.`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 25 * 1024 * 1024) throw new Error("Mídia excede o limite de 25 MB para versionamento.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 25 * 1024 * 1024) throw new Error("Mídia excede o limite de 25 MB para versionamento.");
  return { url: mediaUrl, storageKey: url.pathname, sha256: createHash("sha256").update(bytes).digest("hex"), contentType, bytes };
}

interface BatchOptions {
  triggeredAt?: string;
  batchKey?: string;
  startDate?: Date;
  weekStart?: string;
}

function humanPrompt(ragSystemPrompt: string, language: ContentLanguage = "pt-BR"): string {
  ragSystemPrompt = `${positioningPrompt()}\n\n${CREATIVE_DIRECTION_PROMPT}\n\n${ragSystemPrompt}`;
  const copyRules = language === "en-US"
    ? "Write as a hands-on engineer who experienced the problem. Use idiomatic professional English, concise paragraphs and direct storytelling. Avoid generic AI clichés and fabricated metrics, clients, roles or outcomes."
    : HUMAN_COPY_RULES;
  const frameworks = language === "en-US"
    ? "Use a concrete technical situation, an architectural decision, verified evidence or learning, then a practical takeaway. Keep the hook readable on mobile."
    : contentFrameworkPrompt();
  return `${ragSystemPrompt}\n\n===== editorial anti-AI rules =====\n${copyRules}\n\n===== B2B content framework =====\n${frameworks}`;
}

async function persistCreativeBrief(input: { postId: string; postVersionId?: string; language?: string; brief: ReturnType<typeof buildContentBrief>; prompt: string; mediaUrl?: string | null; review?: Record<string, unknown> }): Promise<void> {
  try {
    const post = await prisma.post.findUnique({ where: { id: input.postId }, select: { currentVersionId: true, language: true } });
    const postVersionId = input.postVersionId ?? post?.currentVersionId;
    if (!postVersionId) throw new Error(`Post ${input.postId} ainda nÃ£o possui versÃ£o textual para associar ao briefing.`);
    const [latest, latestForText, textVersion] = await Promise.all([
      prisma.creativeBrief.findFirst({ where: { postId: input.postId }, orderBy: { version: "desc" }, select: { version: true } }),
      prisma.creativeBrief.findFirst({ where: { postVersionId }, orderBy: { creativeRevision: "desc" }, select: { creativeRevision: true, evidenceSnapshot: true } }),
      prisma.postVersion.findUnique({ where: { id: postVersionId }, select: { contentHash: true } }),
    ]);
    const previousEvidence: unknown[] = Array.isArray(latestForText?.evidenceSnapshot) ? latestForText.evidenceSnapshot : [];
    const preservedEvidence = previousEvidence.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const item = value as Record<string, unknown>;
      if (typeof item.kind !== "string" || typeof item.claim !== "string" || typeof item.verified !== "boolean") return [];
      if (!["PROFESSIONAL_EXPERIENCE", "PORTFOLIO_PROJECT", "CONCEPTUAL_KNOWLEDGE", "PLANNED_FEATURE"].includes(item.kind)) return [];
      return [{ id: typeof item.id === "string" ? item.id : undefined, source: typeof item.source === "string" ? item.source : undefined, kind: item.kind as "PROFESSIONAL_EXPERIENCE" | "PORTFOLIO_PROJECT" | "CONCEPTUAL_KNOWLEDGE" | "PLANNED_FEATURE", claim: item.claim, verified: item.verified, ...(typeof item.claimClassification === "string" ? { claimClassification: item.claimClassification as import("@/lib/creative-brief").ClaimClassification } : {}) }];
    });
    const effectiveBrief = input.brief.evidence.length > 0 || preservedEvidence.length === 0
      ? input.brief
      : { ...input.brief, evidence: preservedEvidence };
    const media = await loadStoredMediaForVersion(input.mediaUrl);
    const rendered = input.review?.renderedImage as Record<string, unknown> | undefined;
    await prisma.$transaction(async (tx) => {
      const created = await tx.creativeBrief.create({
        data: {
          postId: input.postId,
          postVersionId,
          creativeRevision: (latestForText?.creativeRevision ?? 0) + 1,
          version: (latest?.version ?? 0) + 1,
          language: input.language ?? post?.language ?? "pt-BR",
          contentHash: textVersion?.contentHash ?? null,
          mediaHash: media?.sha256 ?? null,
          thesis: effectiveBrief.thesis,
          technicalConflict: effectiveBrief.technicalConflict,
          concreteProblem: effectiveBrief.concreteProblem,
          visualConcept: effectiveBrief.visualConcept,
          shortOverlayTitle: effectiveBrief.shortOverlayTitle,
          evidenceSnapshot: effectiveBrief.evidence as unknown as Prisma.InputJsonValue,
          contentBrief: effectiveBrief as unknown as Prisma.InputJsonValue,
          visualBrief: toVisualBrief(effectiveBrief) as unknown as Prisma.InputJsonValue,
          effectivePrompt: input.prompt,
          mediaUrl: input.mediaUrl ?? null,
          aestheticScore: typeof rendered?.aestheticScore === "number" ? rendered.aestheticScore : null,
          semanticScore: typeof rendered?.semanticScore === "number" ? rendered.semanticScore : null,
          technicalScore: typeof rendered?.technicalScore === "number" ? rendered.technicalScore : null,
          reviewStatus: input.review?.status === "PASS" ? QualityGateStatus.PASS : QualityGateStatus.NEEDS_REVISION,
          reviewSnapshot: input.review ? input.review as unknown as Prisma.InputJsonValue : undefined,
        },
        select: { id: true },
      });
      if (media) {
        let asset = await tx.mediaAsset.findFirst({ where: { storageUrl: media.url }, select: { id: true } });
        if (!asset) asset = await tx.mediaAsset.findUnique({ where: { storageKey: media.storageKey }, select: { id: true } });
        if (!asset) asset = await tx.mediaAsset.create({
          data: {
            origin: "GENERATED_AI", storageProvider: "VERCEL_BLOB", storageKey: media.storageKey,
            storageUrl: media.url, sha256: media.sha256, contentType: media.contentType, byteSize: BigInt(media.bytes.byteLength),
          },
          select: { id: true },
        });
        const role = media.contentType === "application/pdf" ? "FINAL_PDF" : "PRIMARY_IMAGE";
        await tx.creativeBriefMedia.create({ data: { creativeBriefId: created.id, mediaAssetId: asset.id, role, position: 0 } });
      }
      for (const evidence of effectiveBrief.evidence) {
        if (!evidence.id || !evidence.verified || evidence.kind === "PLANNED_FEATURE") continue;
        const sourceSelect = { id: true, contentHash: true, trustLevel: true, visibility: true } as const;
        let target: { id: string; publicAllowed: boolean; visibility: KnowledgeVisibility; evidenceStatus: KnowledgeEvidenceStatus; implementationStatus: ImplementationStatus; source: { id: string; contentHash: string; trustLevel: KnowledgeTrustLevel; visibility: KnowledgeVisibility } } | null = null;
        if (evidence.kind === "PORTFOLIO_PROJECT") {
          const record = await tx.portfolioProject.findUnique({ where: { id: evidence.id }, select: { id: true, publicAllowed: true, visibility: true, evidenceStatus: true, implementationStatus: true, sources: { take: 1, select: { source: { select: sourceSelect } } } } });
          if (record?.sources[0]) target = { ...record, source: record.sources[0].source };
        } else if (evidence.kind === "PROFESSIONAL_EXPERIENCE") {
          const record = await tx.professionalExperience.findUnique({ where: { id: evidence.id }, select: { id: true, publicAllowed: true, visibility: true, evidenceStatus: true, sources: { take: 1, select: { source: { select: sourceSelect } } } } });
          if (record?.sources[0]) target = { ...record, implementationStatus: ImplementationStatus.IMPLEMENTED, source: record.sources[0].source };
        } else {
          const record = await tx.professionalFact.findUnique({ where: { id: evidence.id }, select: { id: true, publicAllowed: true, visibility: true, evidenceStatus: true, implementationStatus: true, sources: { take: 1, select: { source: { select: sourceSelect } } } } });
          if (record?.sources[0]) target = { ...record, source: record.sources[0].source };
        }
        if (!target?.publicAllowed || target.visibility !== "PUBLIC_SAFE") continue;
        if (target.evidenceStatus !== KnowledgeEvidenceStatus.VERIFIED
          && target.evidenceStatus !== KnowledgeEvidenceStatus.DOCUMENTED
          && target.evidenceStatus !== KnowledgeEvidenceStatus.USER_CONFIRMED) continue;
        if (target.implementationStatus === ImplementationStatus.PLANNED || target.implementationStatus === ImplementationStatus.UNKNOWN) continue;
        const relation = evidence.kind === "PORTFOLIO_PROJECT" ? { projectId: target.id }
          : evidence.kind === "PROFESSIONAL_EXPERIENCE" ? { experienceId: target.id }
            : { factId: target.id };
        await tx.creativeBriefEvidence.create({ data: {
          creativeBriefId: created.id,
          evidenceKey: `${evidence.kind.toLowerCase()}:${target.id}`,
          ...relation,
          sourceId: target.source.id,
          claimSnapshot: evidence.claim,
          sourceHash: target.source.contentHash,
          trustLevelSnapshot: target.source.trustLevel,
          visibilitySnapshot: target.visibility,
          sourceVisibilitySnapshot: target.source.visibility,
          implementationStatus: target.implementationStatus,
          publicAllowedSnapshot: target.publicAllowed,
        } });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      console.warn("[creative-brief] tabela ausente; persistência versionada permanece desativada até a migration", { postId: input.postId });
      return;
    }
    throw error;
  }
}

export async function recordRenderedCreativeVersion(input: { postId: string; title: string; textContent: string; editorialPillar: string; slides?: GeneratedSlide[]; prompt: string; mediaUrl: string; review: Record<string, unknown>; visualFormat?: import("../../config/creative-direction").VisualFormat }): Promise<void> {
  const brief = buildContentBrief({ title: input.title, textContent: input.textContent, editorialPillar: input.editorialPillar, visualBullets: input.slides?.[0]?.bullets, visualFormat: input.visualFormat });
  await persistCreativeBrief({ postId: input.postId, brief, prompt: input.prompt, mediaUrl: input.mediaUrl, review: { ...input.review, renderedImage: input.review } });
}

function deterministicWeeklyPosts(language: ContentLanguage = "pt-BR"): GeneratedPost[] {
  const portuguese: GeneratedPost[] = [
    {
      editorialPillar: "TOFU",
      funnelStage: "ATTENTION",
      formatType: "TEXT_ONLY",
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
      formatType: "SINGLE_IMAGE",
      title: "Uma arquitetura de dados madura reduz decisões invisíveis",
      textContent: [
        "Quando a arquitetura explica a origem do número, decisões invisíveis começam a desaparecer.",
        "O ganho não aparece apenas no tempo de execução. Ele aparece quando engenharia, produto e negócio conseguem explicar por que um número mudou.",
        "Uma implementação pragmática começa com camadas bem definidas: dado bruto preservado, transformação auditável e uma camada final orientada ao consumo. O histórico permite reprocessar; os contratos reduzem surpresa; os indicadores mostram o custo operacional.",
        "Com essa base, cada transformação pode ser auditada e reprocessada sem perder a relação entre origem e consumo.",
        "Não é sobre adicionar componentes. É sobre reduzir a distância entre uma mudança na origem e uma decisão explicável.",
        "Qual parte da sua arquitetura ainda não consegue explicar a origem do número?",
      ].join("\n\n"),
      slides: [
        { title: "Dado explicável", bullets: ["Origem preservada", "Transformação auditável", "Consumo com contexto"] },
        { title: "Impacto operacional", bullets: ["Reprocessamento previsível", "Menos decisões invisíveis"] },
        { title: "Próximo passo", bullets: ["Escolha um indicador", "Mapeie sua linhagem", "Meça o custo da mudança"] },
      ],
    },
    {
      editorialPillar: "TOFU",
      funnelStage: "ACTION",
      formatType: "SINGLE_IMAGE",
      title: "O melhor ganho de uma API é reduzir a dúvida de quem opera",
      textContent: [
        "Uma API madura não entrega apenas resposta. Ela reduz a dúvida de quem precisa operar o sistema.",
        "Contratos claros, erros acionáveis e rastreabilidade mudam o custo de investigar incidentes.",
        "Em projetos backend, começo pelo fluxo que precisa ser explicado: entrada, validação, processamento, persistência e observabilidade.",
        "Só depois escolho abstrações e componentes. A decisão técnica fica mais simples quando o comportamento esperado está visível.",
        "Qual parte da sua API ainda depende de interpretação manual?",
      ].join("\n\n"),
      slides: [{ title: "API operável", bullets: ["Contrato claro", "Erro acionável", "Rastreabilidade"] }],
    },
  ];
  if (language === "pt-BR") return portuguese.map((post) => ({ ...post, language }));
  const english: GeneratedPost[] = [
    { ...portuguese[0], title: "A dashboard can be right and still arrive too late", textContent: "A metric can be calculated correctly and still reach a decision-maker after the decision window has closed.\n\nThat is a data freshness problem, not a charting problem.\n\nMeasure the time from the source event to processing and analytical availability. Those timestamps show where the delay enters the path.\n\nA useful freshness objective makes the delay visible, assigns ownership and defines what happens when the data is stale.\n\nWhich decision in your team depends on knowing how old the data is?" },
    { ...portuguese[1], title: "Scaling a pipeline starts with its data contract", textContent: "More compute does not make an unstable schema reliable.\n\nBefore scaling processing, define the expected fields, compatibility rules, update cadence and owner for contract changes.\n\nThen make validation observable: rejected records, nulls, duplicates and late arrivals should have explicit handling.\n\nThat makes capacity a response to measured demand instead of a workaround for unclear inputs.\n\nWhich data contract in your pipeline still lives only in someone's memory?" },
    { ...portuguese[2], title: "A data platform should explain where each number came from", textContent: "When a metric changes, the team needs a traceable path from source to transformation to consumer.\n\nPreserving raw inputs and making transformations inspectable creates a practical route to reproduce a result and investigate a discrepancy.\n\nThe trade-off is storage and operational discipline in exchange for traceability and controlled reprocessing.\n\nStart with one metric and map every step that changes it. Where does your current lineage stop?" },
    { ...portuguese[3], title: "An API is easier to operate when failures carry context", textContent: "A successful response is only one part of a useful API contract.\n\nValidation errors, request identifiers and clear ownership reduce the time spent reconstructing what happened from scattered logs.\n\nThe implementation starts by making inputs, expected failures and persisted outcomes explicit. Then observability can answer a concrete operational question.\n\nWhat context is missing when your team investigates an API failure?" },
  ];
  return english.map((post) => ({ ...post, language }));
}

export async function generateNewPostBatch(options: BatchOptions = {}): Promise<string[]> {
  const pendingApproval = await prisma.post.count({ where: { status: PostStatus.AWAITING_APPROVAL } });
  const availableSlots = Math.max(0, 3 - pendingApproval);
  if (availableSlots === 0) {
    console.info("[content-engine] limite de aprovação atingido; geração ignorada", { pendingApproval, limit: 3 });
    return [];
  }
  const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" } });
  if (!editorialLine) throw new Error("Nenhuma EditorialLine cadastrada para orientar a geração.");

  const referenceDate = options.triggeredAt ? new Date(options.triggeredAt) : new Date();
  if (Number.isNaN(referenceDate.getTime())) throw new Error("triggeredAt inválido.");
  const requestedWeek = options.weekStart ? new Date(options.weekStart) : null;
  if (requestedWeek && Number.isNaN(requestedWeek.getTime())) throw new Error("weekStart invalido.");
  const baseDate = requestedWeek ?? getNextPipelineBaseDate(referenceDate);
  const weekKey = baseDate.toISOString().slice(0, 10);
  const ragContext = await buildRagContext(editorialLine.id);
  const weeklySchedule = normalizeWeeklySchedule(editorialLine.weeklySchedule);
  const configuredCount = 4;
  const generationPrefix = `weekly:${weekKey}:slot:`;
  const existingSlots = await prisma.post.findMany({
    where: { generationKey: { startsWith: generationPrefix } },
    select: { generationKey: true, status: true, qualityStatus: true },
  });
  const availableGenerationSlots = getAvailableWeeklySlots(weekKey, configuredCount, existingSlots);
  if (availableGenerationSlots.length === 0) {
    console.info("[content-engine] no retryable weekly slots remain; existing posts were preserved", { weekKey });
    return [];
  }
  const targetSlots = availableGenerationSlots.slice(0, availableSlots);
  if (targetSlots.length === 0) return [];
  const languagePlan = targetSlots.map((slot) => weeklySchedule[slot.slotIndex]?.language ?? "pt-BR");
  const previousPosts = await prisma.post.findMany({
    where: { OR: [{ createdAt: { gte: new Date(referenceDate.getTime() - 365 * 24 * 60 * 60 * 1000) } }, { status: PostStatus.PUBLISHED }] },
    select: { title: true }, take: 500, orderBy: { createdAt: "desc" },
  });
  const excludedTitles = previousPosts.map((post) => post.title).filter(Boolean);
  let generated: GeneratedPost[];
  let usedDeterministicFallback = false;
  try {
    const byLanguage = new Map<ContentLanguage, GeneratedPost[]>();
    for (const language of ["pt-BR", "en-US"] as const) {
      const count = languagePlan.filter((item) => item === language).length;
      if (count === 0) continue;
      const excludeTopics = [...excludedTitles, ...[...byLanguage.values()].flat().map((post) => post.title)];
      const posts = await generateWithHuggingFace({
        themes: editorialLine.themes,
        toneOfVoice: editorialLine.toneOfVoice,
        aidaRules: editorialLine.aidaRules,
        cvCases: editorialLine.cvCases,
        language,
      }, { ragSystemPrompt: humanPrompt(ragContext.systemPrompt, language), requestedCount: count as 1 | 2 | 3 | 4, language, excludeTopics });
      byLanguage.set(language, posts);
    }
    generated = languagePlan.map((language) => {
      const posts = byLanguage.get(language);
      const post = posts?.shift();
      if (!post) throw new Error(`Geração incompleta para ${language}.`);
      return post;
    });
  } catch (error) {
    console.error("[content-engine] falha de geração multilíngue; usando conteúdo determinístico retido para revisão", {
      error: error instanceof Error ? error.message : String(error),
    });
    usedDeterministicFallback = true;
    const fallbackOffsets: Record<ContentLanguage, number> = { "pt-BR": 0, "en-US": 0 };
    generated = languagePlan.map((language) => {
      const offset = fallbackOffsets[language];
      fallbackOffsets[language] += 1;
      return deterministicWeeklyPosts(language)[offset];
    });
  }

  const ids: string[] = [];
  // Keep the generated sequence aligned with immutable calendar slots; sorting
  // by funnel used to silently swap the intended PT/EN days.
  const orderedGenerated = generated;

  for (const [index, post] of orderedGenerated.entries()) {
    // A chave identifica a tentativa imutável do slot; concorrência reutiliza
    // a mesma chave, enquanto uma revisão reprovada recebe uma chave :revision:N.
    const targetSlot = targetSlots[index];
    if (!targetSlot) continue;
    const { slotIndex, generationKey } = targetSlot;
    const slotConfig = weeklySchedule[slotIndex];
    if (!slotConfig) throw new Error(`Slot editorial ${slotIndex} sem configuração.`);
    const existing = await prisma.post.findUnique({ where: { generationKey } });
    if (existing) {
      console.info("[content-engine] slot was generated concurrently; skipping existing post", { generationKey });
      continue;
    }
    if (hasDuplicatePostTitle(post.title, previousPosts.map((candidate) => candidate.title))) {
      console.warn("[content-engine] generated title resembles a recent post; skipped to prevent repetition", { weekKey, title: post.title });
      continue;
    }

    const formatDecision = selectEditorialFormat({
      requestedFormat: post.formatType,
      title: post.title,
      textContent: post.textContent,
      slides: post.slides,
    });
    const scheduledPost = { ...post, formatType: formatDecision.formatType };
    const theme = classifyEditorialTheme(post.title, post.textContent);
    const prediction = predictEngagement({
      title: post.title,
      textContent: post.textContent,
      editorialPillar: post.editorialPillar,
      dossier: ragContext.dossier,
      ragExamples: ragContext.examples,
    });
    const evidenceTopic = `${post.title} ${post.textContent}`;
    const projectEvidenceDetails = await getVisualProjectEvidenceDetails(evidenceTopic);
    const professionalEvidenceDetails = await getProfessionalEvidenceDetails(evidenceTopic);
    const allEvidenceDetails = [...professionalEvidenceDetails, ...projectEvidenceDetails];
    const projectEvidence = projectEvidenceDetails.map((item) => `${item.claim}${item.source ? ` Fonte: ${item.source}` : ""}`).join("\n");
    const evidenceAwareCareerRelevance = scoreCareerRelevance({ title: post.title, textContent: post.textContent, evidence: allEvidenceDetails });
    const evidenceAwareHookQuality = evaluateHookQuality({ title: post.title, textContent: post.textContent, evidence: allEvidenceDetails, recentTitles: excludedTitles });
    const contentBrief = buildContentBrief({ title: post.title, textContent: post.textContent, editorialPillar: post.editorialPillar, visualBullets: post.slides[0]?.bullets, evidence: allEvidenceDetails, visualFormat: formatDecision.visualFormat });
    const imagePrompt = buildImagePrompt({
      title: post.title,
      textContent: post.textContent,
      editorialPillar: post.editorialPillar,
      visualBullets: post.slides[0]?.bullets,
      negativeFeedback: ragContext.negativeFeedback,
      referenceInsights: ragContext.references,
      visualFormat: formatDecision.visualFormat,
      projectEvidence,
      contentBrief,
    });
    const qualityReview = await reviewPostQuality({
      title: post.title,
      textContent: post.textContent,
      editorialPillar: post.editorialPillar,
      slides: post.slides,
      imagePrompt,
      contentBrief,
    });
    const claimValidation = await validateContentClaims({ title: post.title, textContent: post.textContent, editorialLineId: editorialLine.id });
    const finalQualityReview = {
      ...qualityReview,
      status: claimValidation.blocked ? QualityGateStatus.BLOCKED : qualityReview.evaluation.method !== "AI" ? QualityGateStatus.NEEDS_REVISION : qualityReview.status,
      textIssues: [...qualityReview.textIssues, ...claimValidation.unsupportedClaims.map((claim) => `afirmação sem evidência: ${claim}`)],
      recommendations: [...qualityReview.recommendations, ...(claimValidation.blocked ? ["Remova ou comprove as métricas e resultados destacados antes da aprovação."] : [])],
      summary: claimValidation.blocked ? "Post retido: há afirmações quantitativas sem evidência na base profissional." : qualityReview.summary,
      claims: claimValidation,
    };
    const scheduledDate = options.weekStart
      ? scheduledDateForPost(slotIndex, post.editorialPillar, baseDate, weeklySchedule)
      : options.startDate
      ? rollingScheduledDateForPost(slotIndex, post.editorialPillar, options.startDate)
      : scheduledDateForPost(slotIndex, post.editorialPillar, baseDate, weeklySchedule);
    let saved: Awaited<ReturnType<typeof prisma.post.create>>;
    try {
      saved = await prisma.post.create({
      data: {
        generationKey,
        editorialLineId: editorialLine.id,
        editorialPillar: post.editorialPillar,
        funnelStage: post.funnelStage,
        formatType: scheduledPost.formatType as FormatType,
        language: slotConfig.language,
        editorialObjective: slotConfig.objective,
        associatedProject: projectEvidenceDetails[0]?.claim.split(":")[0] ?? null,
        topic: theme,
        title: post.title,
        textContent: post.textContent,
        imagePrompt,
        slidesJson: post.slides as unknown as Prisma.InputJsonValue,
        engagementScore: prediction.score,
        engagementLabel: prediction.label,
        status: !usedDeterministicFallback && finalQualityReview.status === QualityGateStatus.PASS && ids.length < availableSlots ? PostStatus.AWAITING_APPROVAL : PostStatus.DRAFT,
        qualityScore: Math.min(finalQualityReview.score, claimValidation.score),
        qualityStatus: usedDeterministicFallback ? QualityGateStatus.NEEDS_REVISION : finalQualityReview.status,
        qualityReview: qualityReviewJson({ ...finalQualityReview, editorialIntelligence: {
          theme,
          objective: slotConfig.objective,
          formatReason: formatDecision.reason,
          visualFormat: formatDecision.visualFormat,
          careerRelevance: evidenceAwareCareerRelevance,
          hookQuality: evidenceAwareHookQuality,
          claimClasses: allEvidenceDetails.map((item) => ({ id: item.id ?? null, source: item.source ?? null, kind: item.kind, classification: item.claimClassification ?? "UNCLASSIFIED", claim: item.claim })),
        } }),
        qualityReviewedAt: new Date(),
        scheduledFor: scheduledDate,
        scheduledDate,
      },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        console.info("[content-engine] generation key already claimed by another run; duplicate ignored", { generationKey });
        continue;
      }
      throw error;
    }
    const versionId = await prisma.$transaction(async (tx) => {
      const id = await createPostTextVersion(tx, {
        postId: saved.id,
        snapshot: { title: post.title, textContent: post.textContent, slidesJson: post.slides as unknown as Prisma.InputJsonValue, imagePrompt, language: slotConfig.language },
        reason: "initial-generation",
      });
      const projectIds = projectEvidenceDetails.map((evidence) => evidence.id).filter((projectId): projectId is string => Boolean(projectId));
      for (const [projectIndex, projectId] of projectIds.entries()) {
        await tx.postProject.create({ data: { postId: saved.id, projectId, role: projectIndex === 0 ? "PRIMARY" : "SECONDARY", confirmedBy: "content-engine-public-evidence-match", auditNote: "Relacionamento criado a partir de evidência publicável selecionada para este post." } });
      }
      return id;
    });
    await persistCreativeBrief({ postId: saved.id, postVersionId: versionId, language: slotConfig.language, brief: contentBrief, prompt: imagePrompt });
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
      language: current.language === "en-US" ? "en-US" : "pt-BR",
      ragSystemPrompt: humanPrompt(ragContext.systemPrompt, current.language === "en-US" ? "en-US" : "pt-BR"),
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
  const evidenceTopic = `${regenerated.title} ${regenerated.textContent}`;
  const regeneratedProjectEvidence = await getVisualProjectEvidenceDetails(evidenceTopic);
  const regeneratedProfessionalEvidence = await getProfessionalEvidenceDetails(evidenceTopic);
  const regeneratedEvidence = [...regeneratedProfessionalEvidence, ...regeneratedProjectEvidence];
  const formatDecision = selectEditorialFormat({ requestedFormat: regenerated.formatType, title: regenerated.title, textContent: regenerated.textContent, slides: regenerated.slides });
  const contentBrief = buildContentBrief({ title: regenerated.title, textContent: regenerated.textContent, editorialPillar: regenerated.editorialPillar, visualBullets: regenerated.slides[0]?.bullets, evidence: regeneratedEvidence, visualFormat: formatDecision.visualFormat });
  const refinedImagePrompt = buildImagePrompt({
    title: regenerated.title,
    textContent: regenerated.textContent,
    editorialPillar: regenerated.editorialPillar,
    visualBullets: regenerated.slides[0]?.bullets,
    feedback,
    negativeFeedback: ragContext.negativeFeedback,
    visualFormat: formatDecision.visualFormat,
    contentBrief,
  });
  let mediaUrl: string | null = null;
  if (formatDecision.formatType !== FormatType.TEXT_ONLY) {
    try {
      mediaUrl = await generateImageWithFallback({
        postId,
        title: regenerated.title,
        editorialPillar: regenerated.editorialPillar,
        imagePrompt: refinedImagePrompt,
        visualFormat: formatDecision.visualFormat,
        contentBrief,
        overlayTitle: contentBrief.shortOverlayTitle,
      });
    } catch (error) {
      console.error("[content-engine] image refactor failed", {
        postId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  const qualityReview = await reviewPostQuality({
    title: regenerated.title,
    textContent: regenerated.textContent,
    editorialPillar: regenerated.editorialPillar,
    slides: regenerated.slides,
    imagePrompt: refinedImagePrompt,
    mediaUrl,
    contentBrief,
  });
  const renderedImageReview = mediaUrl ? await reviewRenderedImage({ mediaUrl, title: regenerated.title, editorialPillar: regenerated.editorialPillar, brief: contentBrief }) : null;
  const visualReviewPassed = formatDecision.formatType === FormatType.TEXT_ONLY || Boolean(renderedImageReview && renderedImageReview.score >= 72 && renderedImageReview.textLegible);
  const claimValidation = await validateContentClaims({ title: regenerated.title, textContent: regenerated.textContent, editorialLineId: current.editorialLineId ?? undefined });
  const finalQualityReview = {
    ...qualityReview,
    status: claimValidation.blocked ? QualityGateStatus.BLOCKED : qualityReview.evaluation.method !== "AI" || !visualReviewPassed ? QualityGateStatus.NEEDS_REVISION : qualityReview.status,
    textIssues: [...qualityReview.textIssues, ...claimValidation.unsupportedClaims.map((claim) => `afirmação sem evidência: ${claim}`)],
    recommendations: [...qualityReview.recommendations, ...(claimValidation.blocked ? ["Remova ou comprove as métricas e resultados destacados antes da aprovação."] : [])],
    summary: claimValidation.blocked ? "Reformulação retida: há afirmações quantitativas sem evidência." : qualityReview.summary,
    claims: claimValidation,
    editorialIntelligence: {
      theme: classifyEditorialTheme(regenerated.title, regenerated.textContent),
      objective: current.editorialObjective ?? "Authority",
      formatReason: formatDecision.reason,
      visualFormat: formatDecision.visualFormat,
      careerRelevance: scoreCareerRelevance({ title: regenerated.title, textContent: regenerated.textContent, evidence: regeneratedEvidence }),
      hookQuality: evaluateHookQuality({ title: regenerated.title, textContent: regenerated.textContent, evidence: regeneratedEvidence }),
      claimClasses: regeneratedEvidence.map((item) => ({ id: item.id ?? null, source: item.source ?? null, kind: item.kind, classification: item.claimClassification ?? "UNCLASSIFIED", claim: item.claim })),
    },
    renderedImage: formatDecision.formatType === FormatType.TEXT_ONLY
      ? { status: "NOT_REQUIRED", reviewedMediaUrl: null, reason: "text-first publication format" }
      : renderedImageReview
      ? { ...renderedImageReview, status: visualReviewPassed ? "PASS" : "NEEDS_REVISION", reviewedMediaUrl: mediaUrl }
      : { status: "PENDING_HUMAN_REVIEW", reviewedMediaUrl: null, reason: "multimodal image inspection unavailable" },
  };
  const updated = await prisma.$transaction(async (transaction) => {
    if (!current.currentVersionId) {
      await createPostTextVersion(transaction, {
        postId,
        snapshot: { title: current.title, textContent: current.textContent, slidesJson: current.slidesJson as Prisma.InputJsonValue | null, imagePrompt: current.imagePrompt, mediaUrl: current.mediaUrl, language: current.language },
        reason: "captured-before-first-versioned-edit",
      });
    }
    const versionId = await createPostTextVersion(transaction, {
      postId,
      snapshot: { title: regenerated.title, textContent: regenerated.textContent, slidesJson: regenerated.slides as unknown as Prisma.InputJsonValue, imagePrompt: refinedImagePrompt, mediaUrl, language: current.language },
      reason: `feedback-refactor: ${feedback}`,
    });
    return transaction.post.update({
      where: { id: postId },
      data: {
      title: regenerated.title,
      textContent: regenerated.textContent,
      topic: classifyEditorialTheme(regenerated.title, regenerated.textContent),
      editorialPillar: regenerated.editorialPillar,
      funnelStage: regenerated.funnelStage,
      formatType: formatDecision.formatType,
        imagePrompt: refinedImagePrompt,
      currentVersionId: versionId,
      approvedCreativeBriefId: null,
      slidesJson: regenerated.slides as unknown as Prisma.InputJsonValue,
      mediaUrl,
      engagementScore: prediction.score,
      engagementLabel: prediction.label,
      feedbackText: feedback,
      status: PostStatus.DRAFT,
      qualityScore: formatDecision.formatType === FormatType.TEXT_ONLY
        ? Math.min(finalQualityReview.score, claimValidation.score)
        : renderedImageReview
          ? Math.min(finalQualityReview.score, claimValidation.score, renderedImageReview.score)
          : null,
      qualityStatus: finalQualityReview.status,
      qualityReview: qualityReviewJson(finalQualityReview),
      qualityReviewedAt: new Date(),
      },
    });
  });
  await persistCreativeBrief({ postId, postVersionId: updated.currentVersionId ?? undefined, language: current.language, brief: contentBrief, prompt: refinedImagePrompt, mediaUrl, review: finalQualityReview });
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
