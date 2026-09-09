import { Buffer } from "node:buffer";
import { fetchStockImageUrl, generateImageZeroCost } from "@/lib/image-prompt-engine";

const IMAGEN_MODEL = "imagen-3.0-generate-002";
const GEMINI_GENERATE_IMAGES_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:generateImages`;
const GEMINI_PREDICT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict`;

export interface PremiumImageResult {
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png";
  provider: "gemini-imagen-3" | "unsplash" | "satori";
}

function requireGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY não configurada.");
  return key;
}

function normalizePillar(pillar: string): string {
  return pillar.trim().toUpperCase();
}

export function refineImagePromptForLinkedIn(topic: string, pillar: string): string {
  const normalized = normalizePillar(pillar);
  const safeTopic = topic.replace(/\s+/g, " ").trim().slice(0, 500);

  if (normalized === "TOFU" || /carreira|career|lideranÃ§a|leadership/i.test(normalized)) {
    return [
      `A high-end editorial corporate photograph representing ${safeTopic}.`,
      "Subtle lighting, professional atmosphere, cinematic tones, 35mm lens, shallow depth of field.",
      "Clean composition suitable for a senior technology executive and LinkedIn business audience.",
      "Dark slate and deep navy environment with restrained cyan and amber accents.",
      "NO distorted human features, NO generic AI faces, NO neon oversaturation.",
      "No text, typography, letters, numbers, logos, watermarks, UI or readable symbols.",
    ].join(" ");
  }

  if (normalized === "MOFU" || /estratÃ©gia|strategy/i.test(normalized)) {
    return [
      `A modern minimalist flat vector illustration representing ${safeTopic}.`,
      "Professional tech aesthetics using slate navy blue, deep indigo and subtle gray palette.",
      "Clean lines, elegant composition, Notion and Stripe design system style, balanced negative space.",
      "No text, typography, letters, numbers, logos, watermarks, UI or readable symbols.",
      "NO messy artifacts, NO generic AI collage, NO neon oversaturation.",
    ].join(" ");
  }

  return [
    `A clean isometric 3D data architecture diagram representing ${safeTopic}.`,
    "Matte glassmorphism textures, frosted glass accents, subtle volumetric lighting and professional enterprise software aesthetics.",
    "Minimalist isolated studio background, precise geometry, clear visual hierarchy and generous negative space.",
    "No text, typography, letters, numbers, logos, watermarks, UI or readable symbols.",
    "NO messy artifacts, NO generic AI collage, NO neon oversaturation.",
  ].join(" ");
}

function base64Image(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const generated = Array.isArray(root.generatedImages) ? root.generatedImages[0] : null;
  if (generated && typeof generated === "object") {
    const image = (generated as Record<string, unknown>).image;
    if (image && typeof image === "object") {
      const bytes = (image as Record<string, unknown>).imageBytes;
      if (typeof bytes === "string") return bytes;
    }
    const bytes = (generated as Record<string, unknown>).imageBytes;
    if (typeof bytes === "string") return bytes;
  }
  const prediction = Array.isArray(root.predictions) ? root.predictions[0] : null;
  if (prediction && typeof prediction === "object") {
    const bytes = (prediction as Record<string, unknown>).bytesBase64Encoded;
    if (typeof bytes === "string") return bytes;
  }
  return null;
}

async function requestJson(url: string, headers: HeadersInit, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) throw new Error(`Gemini Imagen ${response.status}: ${typeof payload === "string" ? payload.slice(0, 500) : JSON.stringify(payload).slice(0, 500)}`);
  return payload;
}

async function generateWithGemini(prompt: string): Promise<PremiumImageResult> {
  const key = requireGeminiKey();
  let payload: unknown;
  try {
    payload = await requestJson(`${GEMINI_GENERATE_IMAGES_URL}?key=${encodeURIComponent(key)}`, {}, {
      prompt,
      config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio: "1:1" },
    });
  } catch (legacyError) {
    console.warn("[premium-image] generateImages indisponível; tentando predict", legacyError instanceof Error ? legacyError.message : String(legacyError));
    payload = await requestJson(GEMINI_PREDICT_URL, { "x-goog-api-key": key }, {
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: "1:1", outputOptions: { mimeType: "image/jpeg" } },
    });
  }
  const encoded = base64Image(payload);
  if (!encoded) throw new Error("Gemini Imagen não retornou bytes de imagem.");
  return { buffer: Buffer.from(encoded, "base64"), contentType: "image/jpeg", provider: "gemini-imagen-3" };
}

async function generateFallback(topic: string, pillar: string): Promise<PremiumImageResult> {
  const stockUrl = await fetchStockImageUrl(`${topic} technology enterprise architecture`);
  if (stockUrl) {
    const response = await fetch(stockUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (response.ok) {
      const contentType = response.headers.get("content-type")?.toLowerCase().startsWith("image/png") ? "image/png" : "image/jpeg";
      return { buffer: Buffer.from(await response.arrayBuffer()), contentType, provider: "unsplash" };
    }
  }
  return { buffer: await generateImageZeroCost(topic, pillar), contentType: "image/png", provider: "satori" };
}

export async function generatePremiumPostImage(topic: string, pillar: string, additionalPrompt?: string): Promise<PremiumImageResult> {
  const prompt = [
    refineImagePromptForLinkedIn(topic, pillar),
    additionalPrompt?.trim() ? `Additional art direction: ${additionalPrompt.trim().slice(0, 1_000)}` : "",
  ].filter(Boolean).join(" ");
  try {
    return await generateWithGemini(prompt);
  } catch (error) {
    console.error("[premium-image] Gemini Imagen falhou; usando fallback visual", {
      topic: topic.slice(0, 120),
      pillar,
      error: error instanceof Error ? error.message : String(error),
    });
    return generateFallback(topic, pillar);
  }
}
