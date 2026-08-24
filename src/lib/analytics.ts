import type { EditorialPillar } from "@prisma/client";
import type { RagExample } from "@/lib/rag";

export type EngagementLabel = "Baixo" | "Médio" | "Alto Potential";

export interface EngagementPrediction {
  score: number;
  label: EngagementLabel;
  features: {
    length: number;
    dossierKeywords: number;
    numericMetrics: number;
    hookStrength: number;
    ragSimilarity: number;
  };
}

interface PredictionInput {
  title: string;
  textContent: string;
  editorialPillar: EditorialPillar;
  dossier: string;
  ragExamples?: RagExample[];
}

const stopWords = new Set([
  "a", "as", "ao", "aos", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos",
  "o", "os", "para", "por", "que", "se", "um", "uma", "uns", "umas", "você", "seu", "sua", "sobre",
]);

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function dossierKeywords(dossier: string): string[] {
  return [...new Set(normalize(dossier)
    .split(/[^a-z0-9+#.-]+/)
    .filter((word) => word.length >= 6 && !stopWords.has(word)))].slice(0, 80);
}

function keywordCoverage(text: string, dossier: string): number {
  const normalizedText = normalize(text);
  const keywords = dossierKeywords(dossier);
  if (keywords.length === 0) return 0;
  const hits = keywords.filter((keyword) => normalizedText.includes(keyword)).length;
  return Math.min(100, (hits / Math.min(12, keywords.length)) * 100);
}

function metricsStrength(text: string): number {
  const metrics = text.match(/(?:\+?\d+(?:[.,]\d+)?\s?%|\b\d+(?:[.,]\d+)?\s?(?:dias|pessoas|vezes|k|mil|x)\b)/gi) ?? [];
  return Math.min(100, metrics.length * 25);
}

function hookStrength(title: string, text: string): number {
  const firstLine = `${title}\n${text}`.split(/\r?\n/).find((line) => line.trim())?.trim() ?? title;
  let score = Math.min(35, firstLine.split(/\s+/).length * 4);
  if (/[!?]/.test(firstLine)) score += 25;
  if (/\d/.test(firstLine)) score += 15;
  if (/(mas|por que|como|erro|custa|ninguem|nunca|antes de)/i.test(firstLine)) score += 25;
  return Math.min(100, score);
}

function ragSimilarity(text: string, examples: RagExample[] = [], pillar: EditorialPillar): number {
  const samePillar = examples.filter((example) => example.pillar === pillar);
  if (samePillar.length === 0) return 0;
  const normalizedText = normalize(text);
  const words = [...new Set(normalizedText.split(/\W+/).filter((word) => word.length >= 6))].slice(0, 40);
  const overlap = samePillar.reduce((total, example) => {
    const exampleText = normalize(example.textContent);
    return total + words.filter((word) => exampleText.includes(word)).length;
  }, 0);
  return Math.min(100, (overlap / Math.max(1, words.length)) * 100);
}

export function predictEngagement(input: PredictionInput): EngagementPrediction {
  const combined = `${input.title}\n${input.textContent}`;
  const length = Math.min(100, (input.textContent.length / 1600) * 100);
  const dossierKeywordsScore = keywordCoverage(combined, input.dossier);
  const numericMetrics = metricsStrength(combined);
  const hook = hookStrength(input.title, input.textContent);
  const similarity = ragSimilarity(input.textContent, input.ragExamples, input.editorialPillar);

  // Heurística explicável para cold start; um modelo ml-cart só deve ser treinado
  // quando houver histórico real de impressões, reações e comentários rotulados.
  const score = Math.round(Math.max(0, Math.min(100,
    length * 0.18
    + dossierKeywordsScore * 0.25
    + numericMetrics * 0.22
    + hook * 0.25
    + similarity * 0.10,
  )));
  const label: EngagementLabel = score >= 70 ? "Alto Potential" : score >= 45 ? "Médio" : "Baixo";

  return {
    score,
    label,
    features: {
      length: Math.round(length),
      dossierKeywords: Math.round(dossierKeywordsScore),
      numericMetrics: Math.round(numericMetrics),
      hookStrength: Math.round(hook),
      ragSimilarity: Math.round(similarity),
    },
  };
}
