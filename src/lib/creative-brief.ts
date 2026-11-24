import type { EditorialPillar } from "@prisma/client";
import type { VisualFormat } from "../../config/creative-direction";

export type EvidenceKind = "PROFESSIONAL_EXPERIENCE" | "PORTFOLIO_PROJECT" | "CONCEPTUAL_KNOWLEDGE" | "PLANNED_FEATURE";
export type ClaimClassification = "IMPLEMENTATION_DEMONSTRATED" | "INFRASTRUCTURE_DEFINED_NOT_DEPLOYED" | "VERIFIED_PROFESSIONAL_EXPERIENCE" | "CONCEPTUAL_EXPLANATION" | "EXTERNAL_REFERENCE";

export interface CreativeEvidence {
  id?: string;
  source?: string;
  kind: EvidenceKind;
  claim: string;
  verified: boolean;
  claimClassification?: ClaimClassification;
}

export interface ContentBrief {
  thesis: string;
  technicalConflict: string;
  concreteProblem: string;
  evidence: CreativeEvidence[];
  visualConcept: string;
  shortOverlayTitle: string;
  editorialPillar: EditorialPillar | string;
  visualFormat: VisualFormat;
  visualFlow?: { nodes: string[]; edges: Array<{ from: string; to: string; label?: string }>; scopeNote: string };
}

export interface VisualBrief {
  subject: string;
  thesis: string;
  technicalConflict: string;
  visualConcept: string;
  visualAnchors: string[];
  audience: string;
  negativePrompt: string;
  format: VisualFormat;
  visualFlow?: ContentBrief["visualFlow"];
}

const forbiddenOverlay = /[^\p{L}\p{N}\s?!:.,&+/#-]/gu;

function compact(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function deriveConflict(title: string, text: string): string {
  const source = `${title} ${text}`.toLowerCase();
  if (/quarentena|quarantine/.test(source)) return "A validação precisa separar eventos válidos dos que falham no schema sem descartar o payload original nem perder rastreabilidade.";
  if (/atras|defas|freshness|hor[aá]rio errado|stale/.test(source)) return "Dados corretos, mas disponíveis depois do momento da decisão.";
  if (/contrato|schema|esquema|qualidade/.test(source)) return "Escala operacional versus entradas instáveis e regras ambíguas.";
  if (/arquitetura|linhagem|origem|rastre/.test(source)) return "Velocidade de entrega versus capacidade de explicar a origem do dado.";
  if (/api|backend|erro|observab/.test(source)) return "Resposta rápida versus operação sem contexto suficiente para investigar falhas.";
  return "A decisão de engenharia precisa resolver um problema concreto, não apenas adicionar tecnologia.";
}

function deriveVisualConcept(conflict: string, title: string): string {
  if (/payload original|falham no schema/i.test(conflict)) return "Diagrama de fluxo de dados: Bronze preserva o evento original; Validação de schema divide o caminho entre registros válidos para Silver e registros inválidos para Quarentena. Mostrar a ramificação e a rastreabilidade, sem representar bucket dedicado ou implantação AWS não comprovados.";
  if (/disponíveis depois|defas/i.test(conflict)) return "Linha do tempo visual com evento na origem, relógio atrasado no processamento e indicador chegando depois da janela de decisão; mostrar a lacuna temporal como elemento central.";
  if (/entradas instáveis/i.test(conflict)) return "Fluxo com contrato bem definido de um lado e entradas quebradas do outro, destacando validação, rejeição e retrabalho antes da etapa de escala.";
  if (/origem do dado/i.test(conflict)) return "Camadas conectadas da origem ao indicador final, com uma trilha de linhagem iluminada e um ponto de decisão claramente rastreável.";
  if (/investigar falhas/i.test(conflict)) return "Fluxo de requisição com erro observável, contexto de correlação e caminho de diagnóstico, sem desenhar uma interface genérica.";
  return `Metáfora técnica específica para o conflito central de “${compact(title, 100)}”, com causa, consequência e decisão visíveis na composição.`;
}

function shortTitle(title: string): string {
  const cleaned = compact(title, 100).replace(forbiddenOverlay, "");
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= 6 && cleaned.length <= 48) return cleaned;
  let candidate = words.slice(0, 6).join(" ");
  while (candidate.length > 48 && candidate.split(/\s+/).length > 2) candidate = candidate.split(/\s+/).slice(0, -1).join(" ");
  return candidate || words.slice(0, 2).join(" ");
}

const anchorStopWords = new Set(["para", "com", "sem", "sobre", "entre", "quando", "onde", "como", "porque", "que", "uma", "the", "and", "from", "into", "with", "without", "when", "where", "your", "data", "dados"]);

export function normalizeVisualAnchor(value: string): string {
  const source = value.replace(/\s+/g, " ").trim();
  if (source.length <= 38) return source;
  const firstClause = source.split(/[.!?;:]/, 1)[0]?.trim() ?? source;
  const words = firstClause.match(/[\p{L}\p{N}+#.-]+/gu) ?? [];
  const meaningful = words.filter((word) => !anchorStopWords.has(word.toLocaleLowerCase("pt-BR")));
  for (let count = Math.min(5, meaningful.length); count > 0; count -= 1) {
    const candidate = meaningful.slice(0, count).join(" ");
    if (candidate.length <= 38) return candidate;
  }
  return words.slice(0, 2).join(" ").slice(0, 38);
}

export function buildContentBrief(input: {
  title: string;
  textContent: string;
  editorialPillar: EditorialPillar | string;
  visualBullets?: string[];
  projectEvidence?: CreativeEvidence[];
  evidence?: CreativeEvidence[];
  visualFormat?: VisualFormat;
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
  const quarantineFlow = /quarentena|quarantine/i.test(`${input.title} ${input.textContent}`);
  return {
    thesis: compact(`${firstParagraph} A decisão técnica deve tornar esse problema mensurável e operável.`, 420),
    technicalConflict,
    concreteProblem: compact(firstParagraph, 360),
    evidence,
    visualConcept: deriveVisualConcept(technicalConflict, title),
    shortOverlayTitle: shortTitle(title),
    editorialPillar: input.editorialPillar,
    visualFormat: input.visualFormat ?? "editorial-cover",
    ...(quarantineFlow ? { visualFlow: {
      nodes: ["Bronze", "Validação", "Silver", "Quarentena"],
      edges: [
        { from: "Bronze", to: "Validação", label: "evento original preservado" },
        { from: "Validação", to: "Silver", label: "schema válido" },
        { from: "Validação", to: "Quarentena", label: "schema inválido" },
      ],
      scopeNote: "Fluxo conceitual de tratamento; não afirma bucket dedicado nem execução em produção.",
    } } : {}),
  };
}

export function toVisualBrief(brief: ContentBrief, visualBullets: string[] = []): VisualBrief {
  return {
    subject: brief.shortOverlayTitle,
    thesis: compact(brief.thesis, 420),
    technicalConflict: compact(brief.technicalConflict, 300),
    visualConcept: compact(brief.visualConcept, 650),
    visualAnchors: (visualBullets.length ? visualBullets : brief.visualFlow?.nodes ?? []).map(normalizeVisualAnchor).filter(Boolean).slice(0, 5),
    audience: `profissionais de tecnologia e engenharia no estágio ${brief.editorialPillar}`,
    negativePrompt: "text, typography, letters, words, title, headline, logo, watermark, signature, banner, ugly text, distorted text, blurry, low quality, noise, generic technology stock art, random UI, invented architecture",
    format: brief.visualFormat,
    visualFlow: brief.visualFlow,
  };
}
