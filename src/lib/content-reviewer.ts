import { QualityGateStatus, type EditorialPillar, type Prisma } from "@prisma/client";
import { generateTextWithFallback } from "@/lib/ai-provider";
import { contentQualityIssues, type QualitySlide } from "@/lib/content-quality";

export interface PostQualityReview {
  score: number;
  status: QualityGateStatus;
  evaluation: { status: "COMPLETED"; method: "AI" | "HEURISTIC"; note?: string };
  dimensions: { hook: number | null; clarity: number | null; narrative: number | null; cta: number | null; pillarFit: number | null; visualBrief: number | null };
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
  contentBrief?: unknown;
}

export interface RenderedImageReview {
  score: number;
  textDetected: boolean;
  textLegible: boolean;
  aestheticScore: number;
  semanticScore: number;
  technicalScore: number;
  issues: string[];
  recommendations: string[];
  summary: string;
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

function nullableScore(value: unknown): number | null {
  const parsed = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(parsed)
    ? Math.max(0, Math.min(100, Math.round(parsed)))
    : null;
}

function number(value: unknown, fallback = 0): number {
  return nullableScore(value) ?? fallback;
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
  return { score, status: score >= 72 && local.textIssues.length === 0 ? QualityGateStatus.PASS : QualityGateStatus.NEEDS_REVISION, evaluation: { status: "COMPLETED", method: "HEURISTIC", note: "Avaliador de IA indisponível; pontuação calculada por regras determinísticas." }, dimensions: { hook, clarity, narrative, cta, pillarFit, visualBrief }, textIssues: local.textIssues, visualIssues: local.visualIssues, recommendations: [...local.textIssues, ...local.visualIssues].slice(0, 6), summary: "Revisão heurística concluída; valide as recomendações antes de aprovar." };
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
        { role: "user", content: JSON.stringify({ post, contentBrief: post.contentBrief, deterministicChecks: local }) },
      ],
    });
    const parsed = parseJson(response.choices[0]?.message.content ?? "");
    const dimensions = parsed.dimensions as Record<string, unknown> | undefined;
    const score = nullableScore(parsed.score);
    const parsedDimensions = {
      hook: nullableScore(dimensions?.hook), clarity: nullableScore(dimensions?.clarity),
      narrative: nullableScore(dimensions?.narrative), cta: nullableScore(dimensions?.cta),
      pillarFit: nullableScore(dimensions?.pillarFit), visualBrief: nullableScore(dimensions?.visualBrief),
    };
    if (score === null || Object.values(parsedDimensions).some((value) => value === null)) {
      throw new Error("Revisor retornou pontuação ou dimensão ausente; resultado não será convertido em zero.");
    }
    const status = parsed.status === "BLOCKED" || local.textIssues.some((issue) => /corrompido|proibida/i.test(issue)) ? QualityGateStatus.BLOCKED : score >= 72 && local.textIssues.length === 0 ? QualityGateStatus.PASS : QualityGateStatus.NEEDS_REVISION;
    return {
      score,
      status,
      evaluation: { status: "COMPLETED", method: "AI" },
      dimensions: parsedDimensions as { hook: number; clarity: number; narrative: number; cta: number; pillarFit: number; visualBrief: number },
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

export function qualityReviewJson(review: object): Prisma.InputJsonValue {
  return review as unknown as Prisma.InputJsonValue;
}

export async function reviewRenderedImage(input: { mediaUrl?: string; imageBytes?: Uint8Array; mimeType?: string; title: string; editorialPillar: string; brief?: unknown }): Promise<RenderedImageReview | null> {
  if (!process.env.GEMINI_API_KEY || (!input.imageBytes && (!input.mediaUrl || /\.pdf(?:\?|$)/i.test(input.mediaUrl)))) return null;
  try {
    const response = input.imageBytes ? null : await fetch(input.mediaUrl!, { signal: AbortSignal.timeout(20_000) });
    if (response && !response.ok) throw new Error(`mídia retornou ${response.status}`);
    const mimeType = input.mimeType ?? response?.headers.get("content-type")?.split(";")[0] ?? "image/png";
    if (!mimeType.startsWith("image/")) return null;
    const bytes = input.imageBytes
      ? Buffer.from(input.imageBytes).toString("base64")
      : Buffer.from(await response!.arrayBuffer()).toString("base64");
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
    const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "You are a multimodal art director and technical reviewer for LinkedIn B2B Tech. Inspect the final image pixels, not just the prompt. Score aesthetics, semantic fit to the specific thesis/conflict, and technical accuracy independently. The design may intentionally contain a short programmatically typeset title: report textDetected and textLegible separately, and flag only misspelled, distorted, unintended, or unreadable text. Return JSON only: {score:number,aestheticScore:number,semanticScore:number,technicalScore:number,textDetected:boolean,textLegible:boolean,issues:string[],recommendations:string[],summary:string}. Final score is the minimum of the three dimensions." }] },
        contents: [{ role: "user", parts: [
          { text: JSON.stringify({ title: input.title, editorialPillar: input.editorialPillar, brief: input.brief, task: "Avalie esta imagem final antes da aprovação." }) },
          { inlineData: { mimeType, data: bytes } },
        ] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 800 },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await result.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const parsed = parseJson(text);
    const aestheticScore = number(parsed.aestheticScore, number(parsed.score));
    const semanticScore = number(parsed.semanticScore, number(parsed.score));
    const technicalScore = number(parsed.technicalScore, number(parsed.score));
    const textDetected = parsed.textDetected === true;
    const textLegible = parsed.textLegible === true || (!textDetected && parsed.textLegible !== false);
    return { score: Math.min(aestheticScore, semanticScore, technicalScore), aestheticScore, semanticScore, technicalScore, textDetected, textLegible, issues: strings(parsed.issues), recommendations: strings(parsed.recommendations), summary: typeof parsed.summary === "string" ? parsed.summary : "Revisão visual concluída." };
  } catch (error) {
    console.warn("[content-reviewer] revisão visual indisponível", error instanceof Error ? error.message : String(error));
    return null;
  }
}
