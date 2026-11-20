import { generateImageZeroCost } from "@/lib/image-prompt-engine";
import { generatePremiumPostImage } from "@/lib/premium-image-engine";
import { uploadPublicAsset } from "@/lib/storage";
import type { VisualFormat } from "../../config/creative-direction";
import { getAppUrl } from "@/lib/app-url";
import type { ContentBrief } from "@/lib/creative-brief";

interface SingleImageInput {
  postId: string;
  title: string;
  editorialPillar?: string;
  imagePrompt: string;
  visualFormat?: VisualFormat;
  contentBrief?: ContentBrief;
  overlayTitle?: string;
}

export type ImageAssetInput = SingleImageInput;

/**
 * Generates the visual through Gemini Imagen 3. The premium engine owns the
 * fallback chain (stock photo, then deterministic Satori card).
 */
export async function generateSingleImageAsset(input: SingleImageInput): Promise<string> {
  const generated = await generatePremiumPostImage(
    input.title,
    input.editorialPillar ?? "TECH · DATA · GROWTH",
    input.imagePrompt,
    input.visualFormat,
  );
  const safeName = encodeURIComponent(input.title).slice(0, 120);
  const extension = generated.contentType === "image/jpeg" ? "jpg" : "png";
  const baseUrl = await uploadPublicAsset(
    `linkedin-posts/${input.postId}-${safeName}-premium.${extension}`,
    generated.buffer,
    generated.contentType,
  );
  if (generated.provider === "satori" || !input.overlayTitle?.trim()) return baseUrl;

  const params = new URLSearchParams({ background: baseUrl, title: input.overlayTitle.slice(0, 72), pillar: input.editorialPillar ?? "TECH · DATA · GROWTH", format: input.visualFormat ?? "editorial-cover", v: String(Date.now()) });
  const response = await fetch(`${getAppUrl()}/api/og/creative?${params.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Composição tipográfica retornou ${response.status}.`);
  return uploadPublicAsset(`linkedin-posts/${input.postId}-${safeName}-composed.png`, Buffer.from(await response.arrayBuffer()), "image/png");
}

/**
 * Image boundary used by the content engine. The premium engine already
 * falls back to Unsplash/Satori; this final boundary protects the post from
 * upload or transient rendering failures.
 */
export async function generateImageWithFallback(input: SingleImageInput): Promise<string> {
  try {
    return await generateSingleImageAsset(input);
  } catch (error) {
    console.error("[creative-renderer] premium image generation failed; using zero-cost fallback", {
      postId: input.postId,
      error: error instanceof Error ? error.message : String(error),
    });
    const card = await generateImageZeroCost(input.title, input.editorialPillar ?? "TECH · DATA · GROWTH");
    const safeName = encodeURIComponent(input.title).slice(0, 120);
    return uploadPublicAsset(
      `linkedin-posts/${input.postId}-${safeName}-fallback.png`,
      card,
      "image/png",
    );
  }
}
