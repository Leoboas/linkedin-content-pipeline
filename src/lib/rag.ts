import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImplementationStatus, KnowledgeEvidenceStatus, KnowledgeVisibility, type EditorialPillar } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildEditorialPlan, type EditorialPlan } from "@/lib/editorial-planner";
import { observedInteractionRate } from "@/lib/analytics-data";

const pillars: EditorialPillar[] = ["TOFU", "MOFU", "BOFU"];

export interface RagExample {
  id: string;
  pillar: EditorialPillar;
  title: string;
  textContent: string;
  interactionRate: number;
  impressions: number;
  interactions: number;
  measurementWindow: string;
  exposureHours: number | null;
}

export interface RagContext {
  dossier: string;
  examples: RagExample[];
  latestPublished: PublishedPerformance | null;
  negativeFeedback: string[];
  references: string;
  professionalKnowledge: string;
  editorialPlan: EditorialPlan;
  systemPrompt: string;
}

export interface PublishedPerformance {
  title: string;
  textContent: string;
  editorialPillar: EditorialPillar;
  engagementScore: number | null;
  publishedAt: Date | null;
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
}

export interface RejectionSignal {
  pattern: string;
  occurrenceCount: number;
  feedback?: string;
}

async function loadBrandDossier(): Promise<string> {
  try {
    return await readFile(join(process.cwd(), "data", "brand-dossier.md"), "utf8");
  } catch {
    return "Dossier de marca indisponível. Escreva com tom pragmático, técnico, transparente e orientado a métricas.";
  }
}

async function loadTopPublishedPosts(editorialLineId: string, editorialPillar: EditorialPillar): Promise<RagExample[]> {
  const posts = await prisma.post.findMany({
    where: {
      editorialLineId,
      editorialPillar,
      status: "PUBLISHED",
      metrics: { some: { source: { in: ["LINKEDIN_API", "MANUAL"] }, impressions: { gt: 0 }, availability: { in: ["AVAILABLE", "PARTIAL"] } } },
    },
    orderBy: { publishedAt: "desc" },
    take: 100,
    select: {
      id: true, title: true, textContent: true,
      metrics: {
        where: { source: { in: ["LINKEDIN_API", "MANUAL"] }, availability: { in: ["AVAILABLE", "PARTIAL"] } },
        orderBy: { capturedAt: "desc" }, take: 10,
        select: { impressions: true, reactions: true, comments: true, shares: true, measurementWindow: true, exposureHours: true },
      },
    },
  });

  const measured = posts.flatMap((post) => {
    const metric = post.metrics.find((item) => observedInteractionRate(item) !== null);
    if (!metric || metric.impressions === null || metric.impressions <= 0) return [];
    const interactionRate = observedInteractionRate(metric);
    if (interactionRate === null || metric.reactions === null || metric.comments === null || metric.shares === null) return [];
    return [{
      id: post.id,
      pillar: editorialPillar,
      title: post.title,
      textContent: post.textContent.slice(0, 1800),
      interactionRate,
      impressions: metric.impressions,
      interactions: metric.reactions + metric.comments + metric.shares,
      measurementWindow: metric.measurementWindow,
      exposureHours: metric.exposureHours,
    }];
  });
  const comparisonWindow = (["7D", "72H", "24H"] as const).find((window) => measured.some((item) => item.measurementWindow === window));
  return measured.filter((item) => item.measurementWindow === comparisonWindow)
    .sort((left, right) => right.interactionRate - left.interactionRate).slice(0, 3);
}

async function loadLatestPublishedPerformance(editorialLineId: string): Promise<PublishedPerformance | null> {
  const post = await prisma.post.findFirst({
    where: { editorialLineId, status: "PUBLISHED" },
    orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
    select: {
      title: true,
      textContent: true,
      editorialPillar: true,
      engagementScore: true,
      publishedAt: true,
      metrics: {
        where: { source: { in: ["LINKEDIN_API", "MANUAL"] }, availability: { in: ["AVAILABLE", "PARTIAL"] } },
        orderBy: { capturedAt: "desc" },
        take: 1,
        select: { impressions: true, reactions: true, comments: true, shares: true },
      },
    },
  });
  if (!post) return null;
  const metric = post.metrics[0];
  return {
    title: post.title,
    textContent: post.textContent.slice(0, 1600),
    editorialPillar: post.editorialPillar,
    engagementScore: post.engagementScore,
    publishedAt: post.publishedAt,
    impressions: metric?.impressions ?? null,
    reactions: metric?.reactions ?? null,
    comments: metric?.comments ?? null,
    shares: metric?.shares ?? null,
  };
}

async function loadNegativeSignals(editorialLineId: string): Promise<string[]> {
  const [recentFeedback, patterns] = await Promise.all([
    prisma.post.findMany({
      where: {
        editorialLineId,
        rejectionFeedback: { not: null },
        status: { not: "CANCELLED" },
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { rejectionFeedback: true },
    }),
    prisma.rejectionPattern.findMany({
      orderBy: [{ occurrenceCount: "desc" }, { lastSeenAt: "desc" }],
      take: 3,
      select: { pattern: true, occurrenceCount: true, lastFeedback: true },
    }),
  ]);

  const signals = [
    ...recentFeedback.flatMap((post) => post.rejectionFeedback ? [`Feedback recente: ${post.rejectionFeedback.slice(0, 600)}`] : []),
    ...patterns.map((pattern) => `Padrao recorrente (${pattern.occurrenceCount}x): ${pattern.pattern}${pattern.lastFeedback ? ` — exemplo: ${pattern.lastFeedback.slice(0, 400)}` : ""}`),
  ];
  return [...new Set(signals)];
}

async function loadFileReferences(): Promise<string> {
  const directory = join(process.cwd(), "data", "references");
  let fileContent = "";
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /\.(md|txt)$/i.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    const contents = await Promise.all(files.map(async (file) => {
      const content = await readFile(join(directory, file.name), "utf8");
      return `--- ${file.name} ---\n${content.trim().slice(0, 5000)}`;
    }));
    fileContent = contents.join("\n\n");
  } catch {
    fileContent = "Nenhuma referencia local adicional encontrada em data/references.";
  }

  const databaseReferences = await prisma.contentReference.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { content: true, sourceUrl: true, createdAt: true },
  });
  const databaseContent = databaseReferences.length > 0
    ? databaseReferences.map((reference) => [
        `--- referencia Telegram (${reference.createdAt.toISOString()}) ---`,
        reference.sourceUrl ? `Fonte: ${reference.sourceUrl}` : "",
        reference.content.slice(0, 5000),
      ].filter(Boolean).join("\n")).join("\n\n")
    : "Nenhuma referencia adicionada pelo Telegram com /ref.";
  return [fileContent, "===== referencias adicionadas via Telegram =====", databaseContent].join("\n\n");
}

async function loadProfessionalKnowledge(): Promise<string> {
  const evidenceStatus = {
    in: [KnowledgeEvidenceStatus.VERIFIED, KnowledgeEvidenceStatus.DOCUMENTED, KnowledgeEvidenceStatus.USER_CONFIRMED],
  };
  const commonWhere = {
    publicAllowed: true,
    visibility: KnowledgeVisibility.PUBLIC_SAFE,
    evidenceStatus,
  };

  const [facts, experiences, projects] = await Promise.all([
    prisma.professionalFact.findMany({
      where: commonWhere,
      orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
      take: 80,
      select: {
        claim: true,
        category: true,
        implementationStatus: true,
        sources: { select: { source: { select: { title: true, trustLevel: true } } } },
      },
    }),
    prisma.professionalExperience.findMany({
      where: commonWhere,
      orderBy: [{ current: "desc" }, { updatedAt: "desc" }],
      take: 12,
      select: {
        company: true,
        title: true,
        summary: true,
        technologies: true,
        sources: { select: { source: { select: { title: true, trustLevel: true } } } },
      },
    }),
    prisma.portfolioProject.findMany({
      where: {
        ...commonWhere,
        implementationStatus: { in: [ImplementationStatus.IMPLEMENTED, ImplementationStatus.USED_IN_PORTFOLIO] },
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        name: true,
        summary: true,
        technologies: true,
        themes: true,
        publicUrl: true,
        sources: { select: { source: { select: { title: true, trustLevel: true } } } },
      },
    }),
  ]);

  const sourceLabel = (sources: Array<{ source: { title: string; trustLevel: string } }>): string => {
    const source = sources[0]?.source;
    return source ? `Fonte: ${source.title} (${source.trustLevel})` : "Fonte registrada na base profissional";
  };
  const jsonArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  return [
    "===== fatos profissionais publicáveis =====",
    facts.length > 0
      ? facts.map((fact) => `- [${fact.category}/${fact.implementationStatus}] ${fact.claim}\n  ${sourceLabel(fact.sources)}`).join("\n")
      : "Nenhum fato profissional público confirmado encontrado.",
    "===== experiências profissionais publicáveis =====",
    experiences.length > 0
      ? experiences.map((experience) => [
          `- ${experience.title} — ${experience.company}`,
          `  Contexto: ${experience.summary.slice(0, 900)}`,
          `  Tecnologias: ${jsonArray(experience.technologies).join(", ") || "não informadas"}`,
          `  ${sourceLabel(experience.sources)}`,
        ].join("\n")).join("\n")
      : "Nenhuma experiência profissional pública confirmada encontrada.",
    "===== projetos de portfólio publicáveis =====",
    projects.length > 0
      ? projects.map((project) => [
          `- ${project.name}`,
          `  Resumo: ${project.summary.slice(0, 900)}`,
          `  Tecnologias: ${jsonArray(project.technologies).join(", ") || "não informadas"}`,
          `  Temas: ${jsonArray(project.themes).join(", ") || "não informados"}`,
          project.publicUrl ? `  URL pública: ${project.publicUrl}` : "",
          `  ${sourceLabel(project.sources)}`,
        ].filter(Boolean).join("\n")).join("\n")
      : "Nenhum projeto de portfólio publicável confirmado encontrado.",
    "Regra de evidência: trate este bloco como fonte factual. Não transforme item planejado, pendente ou sem evidência em experiência realizada. Não invente métricas, clientes, cargos ou resultados.",
  ].join("\n");
}

function rejectionPatternFromFeedback(feedback: string): string {
  const normalized = feedback.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const categories = [
    [/imagem|visual|logo|arte|poluid|design/, "melhorar ou simplificar o visual"],
    [/tom|agressiv|diret|voz|lingu/, "ajustar tom e clareza"],
    [/gener|cliche|vazi|superfic/, "evitar linguagem generica"],
    [/metrica|numero|resultado|dado/, "usar evidencia verificavel"],
    [/texto|post|copy|titulo|gancho/, "fortalecer texto e gancho"],
  ] as const;
  const matches = categories.flatMap(([pattern, label]) => pattern.test(normalized) ? [label] : []);
  return matches.length > 0 ? matches.sort().join("; ") : "feedback especifico: " + normalized.replace(/\s+/g, " ").trim().slice(0, 120);
}

export async function recordRejectionFeedback(postId: string, feedback: string): Promise<void> {
  const normalizedFeedback = feedback.trim();
  if (!normalizedFeedback) return;
  const current = await prisma.post.findUnique({ where: { id: postId }, select: { rejectionFeedback: true } });
  if (current?.rejectionFeedback === normalizedFeedback) return;
  const pattern = rejectionPatternFromFeedback(normalizedFeedback);
  await prisma.$transaction(async (transaction) => {
    await transaction.post.update({ where: { id: postId }, data: { rejectionFeedback: normalizedFeedback } });
    await transaction.rejectionPattern.upsert({
      where: { pattern },
      create: { pattern, occurrenceCount: 1, lastFeedback: normalizedFeedback, lastSeenAt: new Date() },
      update: { occurrenceCount: { increment: 1 }, lastFeedback: normalizedFeedback, lastSeenAt: new Date() },
    });
  });
}

function formatExamples(examples: RagExample[]): string {
  if (examples.length === 0) {
    return "Ainda não há posts publicados com score de engajamento neste histórico. Use o dossier como fonte principal e não invente resultados.";
  }

  return examples.map((example, index) => [
    `Exemplo ${index + 1} — pilar ${example.pillar} — taxa observada ${example.interactionRate.toFixed(2)}% no snapshot cumulativo ${example.measurementWindow} (idade real: ${example.exposureHours ?? "indisponível"}h); ${example.impressions} impressões e ${example.interactions} interações`,
    `Título: ${example.title}`,
    `Texto publicado:\n${example.textContent}`,
  ].join("\n")).join("\n\n---\n\n");
}

function formatLatestPerformance(performance: PublishedPerformance | null): string {
  if (!performance) {
    return "Ainda nao ha um post publicado para calibrar a proxima rodada. Use boas praticas de gancho, evidencia e CTA sem inventar metricas.";
  }
  const rate = observedInteractionRate(performance);
  const observedMetrics = performance.impressions !== null && performance.reactions !== null && performance.comments !== null && performance.shares !== null
    ? `${performance.impressions} impressões, ${performance.reactions} reações, ${performance.comments} comentários e ${performance.shares} compartilhamentos (taxa observada: ${rate?.toFixed(2)}%)`
    : "métricas reais indisponíveis ou incompletas; não tratar campos ausentes como zero";
  return [
    `Ultimo post publicado (${performance.editorialPillar}): ${performance.title}`,
    `Score projetado registrado: ${performance.engagementScore === null ? "sem score" : `${performance.engagementScore.toFixed(1)}/100`}.`,
    `Métricas coletadas: ${observedMetrics}.`,
    `Texto de referencia: ${performance.textContent}`,
    "Aprendizado obrigatorio: aumente a especificidade do gancho nas duas primeiras linhas, conecte uma evidencia verificavel a uma decisao tecnica, use no maximo uma metrica autorizada e encerre com CTA conversacional. Nao copie o texto nem invente resultados.",
  ].join("\n");
}

export async function buildRagContext(editorialLineId: string): Promise<RagContext> {
  const [dossier, groupedExamples, latestPublished, negativeFeedback, references, professionalKnowledge, editorialPlan] = await Promise.all([
    loadBrandDossier(),
    Promise.all(pillars.map((pillar) => loadTopPublishedPosts(editorialLineId, pillar))),
    loadLatestPublishedPerformance(editorialLineId),
    loadNegativeSignals(editorialLineId),
    loadFileReferences(),
    loadProfessionalKnowledge(),
    buildEditorialPlan(editorialLineId),
  ]);
  const examples = groupedExamples.flat();
  const systemPrompt = [
    "Você é o estrategista sênior de conteúdo B2B do autor.",
    "Use o dossier de marca abaixo como fonte de posicionamento.",
    "Use a base profissional publicável para ancorar o conteúdo em experiências reais do autor. Quando ela não trouxer evidência, não complete com suposições.",
    "Os exemplos são few-shot: absorva estrutura, clareza e densidade de evidência, mas não copie frases nem métricas.",
    "Use exactly the language requested by the generation task; do not mix languages within one post.",
    "\n===== brand-dossier.md =====\n",
    dossier,
    "\n===== base profissional publicável =====\n",
    professionalKnowledge,
    "\n===== planejamento editorial e anti-repetição =====\n",
    editorialPlan.systemPrompt,
    "\n===== exemplos de alta performance (RAG) =====\n",
    formatExamples(examples),
    "\n===== aprendizado do ultimo post publicado =====\n",
    formatLatestPerformance(latestPublished),
    "\n===== RAG negativo: o que nao fazer =====\n",
    negativeFeedback.length > 0 ? negativeFeedback.join("\n") : "Ainda nao ha recusas catalogadas. Evite genericidade, texto vazio, metricas inventadas e visuais poluidos.",
    "\n===== referencias locais =====\n",
    references,
  ].join("\n");

  return { dossier, examples, latestPublished, negativeFeedback, references, professionalKnowledge, editorialPlan, systemPrompt };
}

export async function getTopRagPosts(editorialLineId: string, editorialPillar: EditorialPillar): Promise<RagExample[]> {
  return loadTopPublishedPosts(editorialLineId, editorialPillar);
}
