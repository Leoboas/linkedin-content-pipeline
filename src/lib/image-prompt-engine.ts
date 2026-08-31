import type { EditorialPillar } from "@prisma/client";
import { getAppUrl } from "@/lib/app-url";

const palette = ["#0F172A", "#0EA5E9", "#F59E0B"] as const;

export interface ImagePromptInput {
  title: string;
  textContent: string;
  editorialPillar?: EditorialPillar;
  visualBullets?: string[];
  feedback?: string;
  negativeFeedback?: string[];
  referenceInsights?: string;
}

interface VisualBrief {
  subject: string;
  narrative: string;
  visualAnchors: string[];
  audience: string;
}

function extractVisualBrief(input: ImagePromptInput): VisualBrief {
  const visualAnchors = (input.visualBullets ?? [])
    .map((bullet) => bullet.trim())
    .filter(Boolean)
    .slice(0, 5);
  const subject = input.title.trim().slice(0, 180);
  const narrative = input.textContent.replace(/\s+/g, " ").trim().slice(0, 700);
  return {
    subject,
    narrative,
    visualAnchors,
    audience: input.editorialPillar
      ? `profissionais de tecnologia e engenharia no estágio ${input.editorialPillar}`
      : "profissionais seniores de tecnologia",
  };
}

function composeFluxPrompt(brief: VisualBrief, feedback?: string, negativeFeedback: string[] = [], referenceInsights?: string): string {
  return [
    "Create a premium editorial visual for a senior technology LinkedIn post.",
    `Main concept: ${brief.subject}.`,
    `Narrative context: ${brief.narrative}.`,
    brief.visualAnchors.length > 0 ? `Visual anchors: ${brief.visualAnchors.join(", ")}.` : "",
    `Target audience: ${brief.audience}.`,
    "Style: minimalistic 3D tech editorial, dark-mode composition, clean geometric layers, high-end data engineering aesthetic, precise hierarchy, generous negative space, realistic materials, subtle depth of field.",
    "Lighting: volumetric cyan rim light with a warm amber key light, controlled contrast, cinematic but restrained.",
    `Strict palette: ${palette.join(", ")}; use #0F172A as the dominant background, #0EA5E9 for technical accents and #F59E0B only for metrics or focal highlights.`,
    referenceInsights?.trim() ? `Visual reference learnings (use only as composition and art-direction cues, never copy branding or layout): ${referenceInsights.trim().slice(0, 3000)}.` : "",
    feedback?.trim() ? `Author feedback to reflect visually: ${feedback.trim().slice(0, 500)}.` : "",
    negativeFeedback.length > 0 ? `Avoid these rejected patterns: ${negativeFeedback.slice(0, 5).join("; ")}.` : "",
    "This is a background plate only. Do not render words, letters, numbers, logos, watermarks, UI screenshots, charts with labels or typography in the image. Final copy will be added programmatically.",
    "Negative prompt: text, typography, letters, words, title, headline, logo, watermark, signature, banner, ugly text, distorted text, blurry, low quality, noise, generic stock art, noisy collage, clutter, random symbols, photorealistic people, distorted objects, oversaturated colors, gradients outside the palette, low contrast, blurry details, duplicated elements, text artifacts, alphabetic characters.",
  ].filter(Boolean).join(" ");
}

/** Two-stage structured prompt chain: visual brief -> model-ready prompt. */
export function buildImagePrompt(input: ImagePromptInput): string {
  return composeFluxPrompt(extractVisualBrief(input), input.feedback, input.negativeFeedback, input.referenceInsights);
}

export const imagePromptPalette = palette;

export function wantsRealPhotography(prompt: string): boolean {
  return /fotograf|photograph|photo-real|photoreal|realistic studio|foto real/i.test(prompt);
}

/**
 * Zero-inference fallback. The endpoint uses @vercel/og/Satori to compose a
 * deterministic card, so it does not consume Hugging Face credits.
 */
export async function generateImageZeroCost(topic: string, pillar: string): Promise<Buffer> {
  const params = new URLSearchParams({ title: topic.slice(0, 95), pillar: pillar.slice(0, 40) });
  const response = await fetch(`${getAppUrl()}/api/og/creative?${params.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Fallback Satori retornou ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

export async function fetchStockImageUrl(query: string): Promise<string | null> {
  const provider = process.env.IMAGE_FALLBACK_PROVIDER?.toLowerCase() ?? "auto";
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  const pexelsKey = process.env.PEXELS_API_KEY;
  const providers = provider === "unsplash"
    ? ["unsplash"]
    : provider === "pexels"
      ? ["pexels"]
      : ["unsplash", "pexels"];

  for (const selected of providers) {
    try {
      if (selected === "unsplash" && unsplashKey) {
        const response = await fetch(`https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape&content_filter=high`, {
          headers: { Authorization: `Client-ID ${unsplashKey}` },
          cache: "no-store",
        });
        if (response.ok) {
          const payload = await response.json() as { urls?: { regular?: string } };
          if (payload.urls?.regular) return payload.urls.regular;
        }
      }
      if (selected === "pexels" && pexelsKey) {
        const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&per_page=1`, {
          headers: { Authorization: pexelsKey },
          cache: "no-store",
        });
        if (response.ok) {
          const payload = await response.json() as { photos?: Array<{ src?: { large2x?: string; original?: string } }> };
          const source = payload.photos?.[0]?.src;
          if (source?.large2x ?? source?.original) return source.large2x ?? source.original ?? null;
        }
      }
    } catch (error) {
      console.warn(`Fallback ${selected} indisponível:`, error);
    }
  }
  return null;
}
