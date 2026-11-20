import type { EditorialPillar } from "@prisma/client";

export type EvidenceKind = "PROFESSIONAL_EXPERIENCE" | "PORTFOLIO_PROJECT" | "CONCEPTUAL_KNOWLEDGE" | "PLANNED_FEATURE";

export interface CreativeEvidence {
  id?: string;
  source?: string;
  kind: EvidenceKind;
  claim: string;
  verified: boolean;
}

export interface ContentBrief {
  thesis: string;
  technicalConflict: string;
  concreteProblem: string;
  evidence: CreativeEvidence[];
  visualConcept: string;
  shortOverlayTitle: string;
  editorialPillar: EditorialPillar | string;
}

export interface VisualBrief {
  subject: string;
  thesis: string;
  technicalConflict: string;
  visualConcept: string;
  visualAnchors: string[];
  audience: string;
  negativePrompt: string;
}

const forbiddenOverlay = /[^\p{L}\p{N}\s?!:.,&+/#-]/gu;

function compact(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function deriveConflict(title: string, text: string): string {
  const source = `${title} ${text}`.toLowerCase();
  if (/atras|defas|freshness|hor[aá]rio errado|stale/.test(source)) return "Dados corretos, mas disponíveis depois do momento da decisão.";
  if (/contrato|schema|esquema|qualidade/.test(source)) return "Escala operacional versus entradas instáveis e regras ambíguas.";
  if (/arquitetura|linhagem|origem|rastre/.test(source)) return "Velocidade de entrega versus capacidade de explicar a origem do dado.";
  if (/api|backend|erro|observab/.test(source)) return "Resposta rápida versus operação sem contexto suficiente para investigar falhas.";
  return "A decisão de engenharia precisa resolver um problema concreto, não apenas adicionar tecnologia.";
}

function deriveVisualConcept(conflict: string, title: string): string {
  if (/disponíveis depois|defas/i.test(conflict)) return "Linha do tempo visual com evento na origem, relógio atrasado no processamento e indicador chegando depois da janela de decisão; mostrar a lacuna temporal como elemento central.";
  if (/entradas instáveis/i.test(conflict)) return "Fluxo com contrato bem definido de um lado e entradas quebradas do outro, destacando validação, rejeição e retrabalho antes da etapa de escala.";
  if (/origem do dado/i.test(conflict)) return "Camadas conectadas da origem ao indicador final, com uma trilha de linhagem iluminada e um ponto de decisão claramente rastreável.";
  if (/investigar falhas/i.test(conflict)) return "Fluxo de requisição com erro observável, contexto de correlação e caminho de diagnóstico, sem desenhar uma interface genérica.";
  return `Metáfora técnica específica para o conflito central de “${compact(title, 100)}”, com causa, consequência e decisão visíveis na composição.`;
}

function shortTitle(title: string): string {
  const cleaned = compact(title, 72).replace(forbiddenOverlay, "");
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= 6) return cleaned;
  return `${words.slice(0, 5).join(" ")}…`;
}

export function buildContentBrief(input: {
  title: string;
  textContent: string;
  editorialPillar: EditorialPillar | string;
  visualBullets?: string[];
  projectEvidence?: CreativeEvidence[];
  evidence?: CreativeEvidence[];
}): ContentBrief {
  const title = compact(input.title, 180);
  const text = compact(input.textContent, 1_200);
  const firstParagraph = input.textContent.split(/\n\s*\n/).map((item) => compact(item, 300)).find(Boolean) ?? text;
  const technicalConflict = deriveConflict(title, text);
  const evidence = [...(input.evidence ?? []), ...(input.projectEvidence ?? [])]
    .filter((item, index, all) => item.verified
      && item.kind !== "PLANNED_FEATURE"
      && all.findIndex((candidate) => candidate.kind === item.kind && candidate.id === item.id) === index)
    .slice(0, 6);
  return {
    thesis: compact(`${firstParagraph} A decisão técnica deve tornar esse problema mensurável e operável.`, 420),
    technicalConflict,
    concreteProblem: compact(firstParagraph, 360),
    evidence,
    visualConcept: deriveVisualConcept(technicalConflict, title),
    shortOverlayTitle: shortTitle(title),
    editorialPillar: input.editorialPillar,
  };
}

export function toVisualBrief(brief: ContentBrief, visualBullets: string[] = []): VisualBrief {
  return {
    subject: brief.shortOverlayTitle,
    thesis: compact(brief.thesis, 420),
    technicalConflict: compact(brief.technicalConflict, 300),
    visualConcept: compact(brief.visualConcept, 650),
    visualAnchors: visualBullets.map((item) => compact(item, 100)).filter(Boolean).slice(0, 5),
    audience: `profissionais de tecnologia e engenharia no estágio ${brief.editorialPillar}`,
    negativePrompt: "text, typography, letters, words, title, headline, logo, watermark, signature, banner, ugly text, distorted text, blurry, low quality, noise, generic technology stock art, random UI, invented architecture",
  };
}
