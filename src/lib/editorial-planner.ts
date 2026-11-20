import type { EditorialPillar, FormatType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EDITORIAL_STRATEGY, editorialStrategyPrompt } from "../../config/editorial-strategy";
import type { CreativeEvidence } from "@/lib/creative-brief";
import { getPerformanceInsights } from "@/lib/performance-insights";

export interface EditorialPlan {
  language: string;
  systemPrompt: string;
  recentTitles: string[];
}

export async function getVisualProjectEvidenceDetails(topic: string): Promise<CreativeEvidence[]> {
  const projects = await prisma.portfolioProject.findMany({
    where: { publicAllowed: true, visibility: "PUBLIC_SAFE", evidenceStatus: { in: ["VERIFIED", "DOCUMENTED", "USER_CONFIRMED"] }, implementationStatus: { in: ["IMPLEMENTED", "USED_IN_PORTFOLIO"] } },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, name: true, summary: true, technologies: true, publicUrl: true },
  });
  const scored = projects.map((project) => ({ project, score: scoreProjectRelevance(topic, project) }));
  // Do not attach an unrelated “top” project when the topic has no meaningful
  // overlap. This was the source of unrelated posts being attributed to DriveSense.
  return scored.filter(({ score }) => score >= 3)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map(({ project }) => ({
    id: project.id,
    source: project.publicUrl ?? `portfolioProject:${project.id}`,
    kind: "PORTFOLIO_PROJECT",
    claim: `${project.name}: ${project.summary.slice(0, 500)} Tecnologias: ${Array.isArray(project.technologies) ? project.technologies.join(", ") : "não informadas"}`,
    verified: true,
  }));
}

/** Return only authorized, sourced facts and experience entries that are materially relevant to a draft. */
export async function getProfessionalEvidenceDetails(topic: string): Promise<CreativeEvidence[]> {
  const acceptedStatuses = ["VERIFIED", "DOCUMENTED", "USER_CONFIRMED"] as const;
  const [facts, experiences] = await Promise.all([
    prisma.professionalFact.findMany({
      where: {
        publicAllowed: true,
        visibility: "PUBLIC_SAFE",
        evidenceStatus: { in: [...acceptedStatuses] },
        implementationStatus: { notIn: ["PLANNED", "UNKNOWN"] },
        sources: { some: {} },
      },
      select: { id: true, claim: true, implementationStatus: true },
      take: 80,
    }),
    prisma.professionalExperience.findMany({
      where: {
        publicAllowed: true,
        visibility: "PUBLIC_SAFE",
        evidenceStatus: { in: [...acceptedStatuses] },
        sources: { some: {} },
      },
      select: { id: true, company: true, title: true, summary: true, technologies: true },
      take: 30,
    }),
  ]);

  const score = (value: string): number => {
    const topicWords = normalizeWords(topic);
    return [...normalizeWords(value)].filter((word) => topicWords.has(word)).length;
  };
  const factEvidence = facts
    .map((fact) => ({ fact, score: score(fact.claim) }))
    .filter(({ score: relevance }) => relevance >= 2)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map(({ fact }) => ({
      id: fact.id,
      source: `professionalFact:${fact.id}`,
      kind: "CONCEPTUAL_KNOWLEDGE" as const,
      claim: fact.claim,
      verified: true,
    }));
  const experienceEvidence = experiences
    .map((experience) => {
      const technologies = Array.isArray(experience.technologies)
        ? experience.technologies.filter((item): item is string => typeof item === "string").join(", ")
        : "";
      const claim = `${experience.title} at ${experience.company}: ${experience.summary}${technologies ? ` Technologies: ${technologies}` : ""}`;
      return { experience, claim, score: score(claim) };
    })
    .filter(({ score: relevance }) => relevance >= 2)
    .sort((left, right) => right.score - left.score)
    .slice(0, 1)
    .map(({ experience, claim }) => ({
      id: experience.id,
      source: `professionalExperience:${experience.id}`,
      kind: "PROFESSIONAL_EXPERIENCE" as const,
      claim,
      verified: true,
    }));

  return [...factEvidence, ...experienceEvidence];
}

export function scoreProjectRelevance(topic: string, project: { name: string; summary: string; technologies: unknown }): number {
  const words = normalizeWords(topic);
  const projectWords = normalizeWords(`${project.name} ${project.summary} ${JSON.stringify(project.technologies)}`);
  const overlap = [...projectWords].filter((word) => words.has(word));
  const nameMention = [...normalizeWords(project.name)].filter((word) => words.has(word)).length;
  return overlap.length >= 2 ? overlap.length + nameMention * 2 : 0;
}

export async function getVisualProjectEvidence(topic: string): Promise<string> {
  const evidence = await getVisualProjectEvidenceDetails(topic);
  return evidence.length > 0 ? evidence.map((item) => `Projeto comprovado [${item.id}]: ${item.claim}${item.source ? ` Referência: ${item.source}` : ""}`).join("\n\n") : "Nenhum projeto publicável relacionado foi encontrado; use abstrações visuais sem inventar uma arquitetura específica.";
}

function normalizeWords(value: string): Set<string> {
  return new Set(value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/gu, "").match(/[a-z0-9]{4,}/gu) ?? []);
}

function similarity(left: string, right: string): number {
  const a = normalizeWords(left);
  const b = normalizeWords(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  return intersection / Math.max(a.size, b.size);
}

export async function buildEditorialPlan(editorialLineId: string): Promise<EditorialPlan> {
  const [line, recentPosts, performance] = await Promise.all([
    prisma.editorialLine.findUnique({ where: { id: editorialLineId }, select: { language: true } }),
    prisma.post.findMany({
      where: {
        editorialLineId,
        status: { notIn: ["CANCELLED", "ARCHIVED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { title: true, editorialPillar: true, formatType: true, status: true },
    }),
    getPerformanceInsights(),
  ]);

  const recentTitles = recentPosts.map((post) => post.title);
  const repeatedPairs = recentPosts.flatMap((post, index) => {
    const duplicate = recentTitles.slice(index + 1).find((title) => similarity(post.title, title) >= 0.6);
    return duplicate ? [`"${post.title}" ↔ "${duplicate}"`] : [];
  }).slice(0, 8);

  const recentByPillar = (Object.keys(EDITORIAL_STRATEGY.pillars) as EditorialPillar[]).map((pillar) => {
    const posts = recentPosts.filter((post) => post.editorialPillar === pillar).slice(0, 5);
    return `${pillar}: ${posts.length > 0 ? posts.map((post) => `${post.title} [${post.formatType}/${post.status}]`).join(" | ") : "sem histórico recente"}`;
  });

  const systemPrompt = [
    editorialStrategyPrompt(),
    "REGRAS DE DIVERSIFICAÇÃO:",
    "Não repita título, gancho, exemplo ou estrutura de posts recentes. Mude o recorte técnico, o público ou o formato.",
    "Não transforme a mesma experiência em vários posts quase idênticos. Alterne entre projeto, decisão arquitetural, incidente, trade-off e aprendizado.",
    "Use somente projetos e experiências existentes na base profissional publicável. Itens planejados ou sem evidência devem ser tratados como hipótese, nunca como resultado realizado.",
    "Quando o contexto permitir, alterne português do Brasil e inglês técnico sem misturar idiomas dentro do mesmo post.",
    "Histórico recente por pilar:",
    ...recentByPillar,
    repeatedPairs.length > 0 ? `Possíveis repetições detectadas: ${repeatedPairs.join("; ")}` : "Nenhuma repetição forte detectada no histórico recente.",
    "APRENDIZADO DE DESEMPENHO OBSERVADO (somente snapshots reais da API ou importações manuais identificadas):",
    performance.snapshots > 0
      ? `Cobertura: ${performance.coverage.apiSnapshots} snapshots de API e ${performance.coverage.manualSnapshots} manuais. Compare apenas a mesma janela de exposição. Agrupamentos descritivos: ${JSON.stringify(performance.comparisonsByExposureWindow.slice(0, 18))}. As diferenças são hipóteses, não causalidade. Não trate score preditivo ou referências externas como desempenho observado.`
      : "Ainda sem snapshots reais suficientes. Não afirme quais temas, idiomas ou formatos performam melhor; priorize diversidade e proponha testes controlados.",
    performance.hypotheses.length > 0
      ? `Hipóteses exploratórias a testar: ${performance.hypotheses.slice(0, 4).map((item) => item.hypothesis).join("; ")}`
      : "A amostra não sustenta hipóteses comparativas; não otimizar para um único post.",
  ].join("\n");

  return { language: line?.language ?? "pt-BR", systemPrompt, recentTitles };
}

export function isRecentTitleTooSimilar(title: string, recentTitles: string[]): boolean {
  return recentTitles.some((recentTitle) => similarity(title, recentTitle) >= 0.6);
}
