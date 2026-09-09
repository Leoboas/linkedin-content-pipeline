import { generateImageZeroCost } from "@/lib/image-prompt-engine";
import { generatePremiumPostImage } from "@/lib/premium-image-engine";
import { uploadPublicAsset } from "@/lib/storage";

interface SingleImageInput {
  postId: string;
  title: string;
  editorialPillar?: string;
  imagePrompt: string;
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
  );
  const safeName = encodeURIComponent(input.title).slice(0, 120);
  const extension = generated.contentType === "image/jpeg" ? "jpg" : "png";

  return uploadPublicAsset(
    `linkedin-posts/${input.postId}-${safeName}-premium.${extension}`,
    generated.buffer,
    generated.contentType,
  );
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
