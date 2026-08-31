import type { EditorialPillar } from "@prisma/client";

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
    "Negative prompt: generic stock art, noisy collage, clutter, random symbols, photorealistic people, distorted objects, oversaturated colors, gradients outside the palette, low contrast, blurry details, duplicated elements, text artifacts, watermark, logo, alphabetic characters.",
  ].filter(Boolean).join(" ");
}

/** Two-stage structured prompt chain: visual brief -> model-ready prompt. */
export function buildImagePrompt(input: ImagePromptInput): string {
  return composeFluxPrompt(extractVisualBrief(input), input.feedback, input.negativeFeedback, input.referenceInsights);
}

export const imagePromptPalette = palette;
