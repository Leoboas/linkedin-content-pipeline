import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EditorialPillar } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const pillars: EditorialPillar[] = ["TOFU", "MOFU", "BOFU"];

export interface RagExample {
  id: string;
  pillar: EditorialPillar;
  title: string;
  textContent: string;
  engagementScore: number;
}

export interface RagContext {
  dossier: string;
  examples: RagExample[];
  latestPublished: PublishedPerformance | null;
  systemPrompt: string;
}

export interface PublishedPerformance {
  title: string;
  textContent: string;
  editorialPillar: EditorialPillar;
  engagementScore: number | null;
  publishedAt: Date | null;
  impressions: number;
  reactions: number;
  comments: number;
  shares: number;
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
      engagementScore: { not: null },
    },
    orderBy: { engagementScore: "desc" },
    take: 3,
    select: { id: true, title: true, textContent: true, engagementScore: true },
  });

  return posts.flatMap((post) => {
    if (post.engagementScore === null) return [];
    return [{
      id: post.id,
      pillar: editorialPillar,
      title: post.title,
      textContent: post.textContent.slice(0, 1800),
      engagementScore: post.engagementScore,
    }];
  });
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
    impressions: metric?.impressions ?? 0,
    reactions: metric?.reactions ?? 0,
    comments: metric?.comments ?? 0,
    shares: metric?.shares ?? 0,
  };
}

function formatExamples(examples: RagExample[]): string {
  if (examples.length === 0) {
    return "Ainda não há posts publicados com score de engajamento neste histórico. Use o dossier como fonte principal e não invente resultados.";
  }

  return examples.map((example, index) => [
    `Exemplo ${index + 1} — pilar ${example.pillar} — score ${example.engagementScore.toFixed(1)}/100`,
    `Título: ${example.title}`,
    `Texto publicado:\n${example.textContent}`,
  ].join("\n")).join("\n\n---\n\n");
}

function formatLatestPerformance(performance: PublishedPerformance | null): string {
  if (!performance) {
    return "Ainda nao ha um post publicado para calibrar a proxima rodada. Use boas praticas de gancho, evidencia e CTA sem inventar metricas.";
  }
  const interactions = performance.reactions + performance.comments + performance.shares;
  const rate = performance.impressions > 0
    ? ((interactions / performance.impressions) * 100).toFixed(2)
    : "sem dados de impressoes";
  return [
    `Ultimo post publicado (${performance.editorialPillar}): ${performance.title}`,
    `Score projetado registrado: ${performance.engagementScore === null ? "sem score" : `${performance.engagementScore.toFixed(1)}/100`}.`,
    `Metricas coletadas: ${performance.impressions} impressoes, ${performance.reactions} reacoes, ${performance.comments} comentarios e ${performance.shares} compartilhamentos (taxa de interacao: ${rate}).`,
    `Texto de referencia: ${performance.textContent}`,
    "Aprendizado obrigatorio: aumente a especificidade do gancho nas duas primeiras linhas, conecte uma evidencia verificavel a uma decisao tecnica, use no maximo uma metrica autorizada e encerre com CTA conversacional. Nao copie o texto nem invente resultados.",
  ].join("\n");
}

export async function buildRagContext(editorialLineId: string): Promise<RagContext> {
  const [dossier, groupedExamples, latestPublished] = await Promise.all([
    loadBrandDossier(),
    Promise.all(pillars.map((pillar) => loadTopPublishedPosts(editorialLineId, pillar))),
    loadLatestPublishedPerformance(editorialLineId),
  ]);
  const examples = groupedExamples.flat();
  const systemPrompt = [
    "Você é o estrategista sênior de conteúdo B2B do autor.",
    "Use o dossier de marca abaixo como fonte de posicionamento.",
    "Os exemplos são few-shot: absorva estrutura, clareza e densidade de evidência, mas não copie frases nem métricas.",
    "Retorne conteúdo original em português do Brasil.",
    "\n===== brand-dossier.md =====\n",
    dossier,
    "\n===== exemplos de alta performance (RAG) =====\n",
    formatExamples(examples),
    "\n===== aprendizado do ultimo post publicado =====\n",
    formatLatestPerformance(latestPublished),
  ].join("\n");

  return { dossier, examples, latestPublished, systemPrompt };
}

export async function getTopRagPosts(editorialLineId: string, editorialPillar: EditorialPillar): Promise<RagExample[]> {
  return loadTopPublishedPosts(editorialLineId, editorialPillar);
}
