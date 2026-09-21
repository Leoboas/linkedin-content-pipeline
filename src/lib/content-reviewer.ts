import { QualityGateStatus, type EditorialPillar, type Prisma } from "@prisma/client";
import { generateTextWithFallback } from "@/lib/ai-provider";
import { contentQualityIssues, type QualitySlide } from "@/lib/content-quality";

export interface PostQualityReview {
  score: number;
  status: QualityGateStatus;
  dimensions: { hook: number; clarity: number; narrative: number; cta: number; pillarFit: number; visualBrief: number };
  textIssues: string[];
  visualIssues: string[];
  recommendations: string[];
  summary: string;
}

export interface ReviewablePost {
  title: string;
  textContent: string;
  editorialPillar: EditorialPillar;
  slides: QualitySlide[];
  imagePrompt?: string | null;
  mediaUrl?: string | null;
}

function parseJson(value: string): Record<string, unknown> {
  const fence = String.fromCharCode(96).repeat(3);
  const cleaned = value.trim().startsWith(fence)
    ? value.trim().slice(fence.length).replace(/^json\s*/i, "").replace(new RegExp(fence + "\\s*$"), "").trim()
    : value.trim();
  try { return JSON.parse(cleaned) as Record<string, unknown>; }
  catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Revisor não retornou JSON válido.");
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  }
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 8) : [];
}

function localReview(post: ReviewablePost): { textIssues: string[]; visualIssues: string[] } {
  const textIssues = contentQualityIssues({ title: post.title, textContent: post.textContent, editorialPillar: post.editorialPillar, slides: post.slides }, { expectedPillar: post.editorialPillar });
  const visualIssues: string[] = [];
  if (!post.imagePrompt?.trim()) visualIssues.push("brief visual ausente");
  if (post.imagePrompt && /text|typography|letters|words|logo|watermark/i.test(post.imagePrompt) && !/negative|no text|sem texto/i.test(post.imagePrompt)) visualIssues.push("prompt visual pode induzir texto ou artefatos na imagem");
  if (post.slides.some((slide) => slide.title.length > 70 || slide.bullets.some((bullet) => bullet.length > 150))) visualIssues.push("lâminas com excesso de texto");
  return { textIssues: [...new Set(textIssues)], visualIssues: [...new Set(visualIssues)] };
}

function fallbackReview(post: ReviewablePost, local: { textIssues: string[]; visualIssues: string[] }): PostQualityReview {
  const hook = post.textContent.split(/\r?\n/).find(Boolean)?.length ? 72 : 25;
  const clarity = local.textIssues.some((issue) => /corrompido|duplicado|fora do limite/i.test(issue)) ? 35 : 78;
  const narrative = post.textContent.split(/\n\s*\n/).length >= 4 ? 78 : 42;
  const cta = /[?!]/.test(post.textContent.slice(-360)) ? 76 : 35;
  const pillarFit = 72;
  const visualBrief = local.visualIssues.length === 0 ? 78 : 40;
  const score = Math.max(0, Math.min(100, Math.round((hook + clarity + narrative + cta + pillarFit + visualBrief) / 6 - local.textIssues.length * 4 - local.visualIssues.length * 5)));
  return { score, status: score >= 72 && local.textIssues.length === 0 ? QualityGateStatus.PASS : QualityGateStatus.NEEDS_REVISION, dimensions: { hook, clarity, narrative, cta, pillarFit, visualBrief }, textIssues: local.textIssues, visualIssues: local.visualIssues, recommendations: [...local.textIssues, ...local.visualIssues].slice(0, 6), summary: "Revisão determinística aplicada porque o juiz de IA não estava disponível." };
}

export async function reviewPostQuality(post: ReviewablePost): Promise<PostQualityReview> {
  const local = localReview(post);
  try {
    const response = await generateTextWithFallback({
      model: process.env.CONTENT_REVIEWER_MODEL || "gemini-3.6-flash",
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: [
          "Você é uma editora sênior de LinkedIn B2B Tech e revisora visual de conteúdo.",
          "Avalie o rascunho antes da aprovação humana. Não reescreva; identifique problemas concretos e ações de melhoria.",
          "Considere gancho, clareza, narrativa, especificidade, CTA, adequação ao pilar e qualidade do briefing visual.",
          "Reprove clichês, texto genérico, afirmações sem evidência, excesso de texto em lâminas e prompts que induzam letras na imagem.",
          "Retorne exclusivamente JSON: {score,dimensions:{hook,clarity,narrative,cta,pillarFit,visualBrief},textIssues:string[],visualIssues:string[],recommendations:string[],summary:string,status:'PASS'|'NEEDS_REVISION'|'BLOCKED'}.",
        ].join(" ") },
        { role: "user", content: JSON.stringify({ post, deterministicChecks: local }) },
      ],
    });
    const parsed = parseJson(response.choices[0]?.message.content ?? "");
    const dimensions = parsed.dimensions as Record<string, unknown> | undefined;
    const score = number(parsed.score);
    const status = parsed.status === "BLOCKED" || local.textIssues.some((issue) => /corrompido|proibida/i.test(issue)) ? QualityGateStatus.BLOCKED : score >= 72 && local.textIssues.length === 0 ? QualityGateStatus.PASS : QualityGateStatus.NEEDS_REVISION;
    return {
      score,
      status,
      dimensions: { hook: number(dimensions?.hook), clarity: number(dimensions?.clarity), narrative: number(dimensions?.narrative), cta: number(dimensions?.cta), pillarFit: number(dimensions?.pillarFit), visualBrief: number(dimensions?.visualBrief) },
      textIssues: [...new Set([...local.textIssues, ...strings(parsed.textIssues)])],
      visualIssues: [...new Set([...local.visualIssues, ...strings(parsed.visualIssues)])],
      recommendations: strings(parsed.recommendations),
      summary: typeof parsed.summary === "string" ? parsed.summary : "Revisão concluída.",
    };
  } catch (error) {
    console.warn("[content-reviewer] juiz de IA indisponível; usando revisão determinística", error instanceof Error ? error.message : String(error));
    return fallbackReview(post, local);
  }
}

export function qualityReviewJson(review: PostQualityReview): Prisma.InputJsonValue {
  return review as unknown as Prisma.InputJsonValue;
}
