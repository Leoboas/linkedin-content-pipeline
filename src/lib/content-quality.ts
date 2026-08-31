import type { EditorialPillar } from "@prisma/client";

export interface QualitySlide {
  title: string;
  bullets: string[];
  code?: string;
  metrics?: string[];
}

export interface QualityPost {
  title: string;
  textContent: string;
  editorialPillar: EditorialPillar;
  slides: QualitySlide[];
}

export interface ContentQualityOptions {
  expectedPillar?: EditorialPillar;
}

const bannedExpressions = [
  "no mundo dinamico de hoje",
  "revolucionario",
  "desvendar",
  "desbloquear",
  "mergulhar",
  "alavancar",
  "junte-se a nos",
  "continue com a gente",
  "vamos explorar",
  "solucao inovadora",
  "game changer",
];

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function nonEmptyLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function repeatedParagraphs(value: string): boolean {
  const paragraphs = value.split(/\n\s*\n/).map((paragraph) => fold(paragraph)).filter(Boolean);
  return new Set(paragraphs).size !== paragraphs.length;
}

/**
 * This gate is deliberately deterministic. A model response is never sent
 * for approval until it satisfies these checks, both on first generation and
 * after a feedback-based rewrite.
 */
export function contentQualityIssues(post: QualityPost, options: ContentQualityOptions = {}): string[] {
  const issues: string[] = [];
  const title = post.title.trim();
  const text = post.textContent.trim();
  const folded = fold(`${title}\n${text}`);
  const lines = nonEmptyLines(text);

  if (options.expectedPillar && post.editorialPillar !== options.expectedPillar) {
    issues.push("pilar editorial alterado");
  }
  if (title.length < 12 || title.length > 95) issues.push("titulo fora do limite de leitura");
  if (text.length < 420 || text.length > 1800) issues.push("texto fora do limite de publicacao");
  if (lines.length < 4) issues.push("texto sem paragrafos suficientes");
  if (lines.slice(0, 2).join(" ").length < 35) issues.push("gancho fraco nas duas primeiras linhas");
  if (!/[?!:]/.test(lines.slice(0, 2).join(" "))) issues.push("gancho sem tensao ou contraste");
  if (!/[?!]/.test(text.slice(-360))) issues.push("CTA conversacional ausente");
  if (repeatedParagraphs(text)) issues.push("paragrafos duplicados");
  if ((text.match(/\s[-–—]\s/g) ?? []).length > 4) issues.push("excesso de hifens ou travessoes");
  if ((text.match(/^[•●▪*-]/gm) ?? []).length > 4) issues.push("lista corrida em vez de narrativa");
  if (/[�]|Ã.|Â.|â./.test(text)) issues.push("texto com caracteres corrompidos");
  if (bannedExpressions.some((expression) => folded.includes(expression))) issues.push("linguagem generica ou proibida");

  const normalizedTitle = fold(title);
  const normalizedText = fold(text);
  if (normalizedTitle && normalizedText.startsWith(normalizedTitle)) issues.push("titulo repetido no inicio da copy");

  if (post.slides.length === 0) issues.push("conteudo visual sem estrutura");
  for (const [index, slide] of post.slides.entries()) {
    if (slide.title.trim().length < 3 || slide.title.trim().length > 80) issues.push(`titulo da lamina ${index + 1} invalido`);
    if (slide.bullets.length > 5) issues.push(`lamina ${index + 1} poluida`);
    if (slide.bullets.some((bullet) => bullet.trim().length > 170)) issues.push(`bullet longo na lamina ${index + 1}`);
    if (/[�]|Ã.|Â.|â./.test(`${slide.title} ${slide.bullets.join(" ")}`)) issues.push(`texto corrompido na lamina ${index + 1}`);
  }

  return [...new Set(issues)];
}

export function assertContentQuality(post: QualityPost, options: ContentQualityOptions = {}): void {
  const issues = contentQualityIssues(post, options);
  if (issues.length > 0) {
    throw new Error(`Conteudo reprovado pelo quality gate: ${issues.join(", ")}.`);
  }
}
