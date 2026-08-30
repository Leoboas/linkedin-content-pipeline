import type { EditorialPillar } from "@prisma/client";

const palette = ["#0F172A", "#0EA5E9", "#F59E0B"] as const;

export interface ImagePromptInput {
  title: string;
  textContent: string;
  editorialPillar?: EditorialPillar;
  visualBullets?: string[];
  feedback?: string;
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

function composeFluxPrompt(brief: VisualBrief, feedback?: string): string {
  return [
    "Create a premium editorial visual for a senior technology LinkedIn post.",
    `Main concept: ${brief.subject}.`,
    `Narrative context: ${brief.narrative}.`,
    brief.visualAnchors.length > 0 ? `Visual anchors: ${brief.visualAnchors.join(", ")}.` : "",
    `Target audience: ${brief.audience}.`,
    "Style: minimalistic 3D tech editorial, dark-mode composition, clean geometric layers, high-end data engineering aesthetic, precise hierarchy, generous negative space, realistic materials, subtle depth of field.",
    "Lighting: volumetric cyan rim light with a warm amber key light, controlled contrast, cinematic but restrained.",
    `Strict palette: ${palette.join(", ")}; use #0F172A as the dominant background, #0EA5E9 for technical accents and #F59E0B only for metrics or focal highlights.`,
    feedback?.trim() ? `Author feedback to reflect visually: ${feedback.trim().slice(0, 500)}.` : "",
    "Do not render words, letters, logos, watermarks, UI screenshots or illegible typography in the image.",
    "Negative prompt: generic stock art, noisy collage, clutter, random symbols, photorealistic people, distorted objects, oversaturated colors, gradients outside the palette, low contrast, blurry details, duplicated elements, text artifacts, watermark, logo.",
  ].filter(Boolean).join(" ");
}

/** Two-stage structured prompt chain: visual brief -> model-ready prompt. */
export function buildImagePrompt(input: ImagePromptInput): string {
  return composeFluxPrompt(extractVisualBrief(input), input.feedback);
}

export const imagePromptPalette = palette;
