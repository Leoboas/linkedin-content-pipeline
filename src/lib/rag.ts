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
  systemPrompt: string;
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

export async function buildRagContext(editorialLineId: string): Promise<RagContext> {
  const [dossier, groupedExamples] = await Promise.all([
    loadBrandDossier(),
    Promise.all(pillars.map((pillar) => loadTopPublishedPosts(editorialLineId, pillar))),
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
  ].join("\n");

  return { dossier, examples, systemPrompt };
}

export async function getTopRagPosts(editorialLineId: string, editorialPillar: EditorialPillar): Promise<RagExample[]> {
  return loadTopPublishedPosts(editorialLineId, editorialPillar);
}
