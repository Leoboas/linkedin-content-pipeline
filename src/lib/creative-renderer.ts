import { getAppUrl } from "@/lib/app-url";
import { fetchStockImageUrl, generateImageZeroCost, wantsRealPhotography } from "@/lib/image-prompt-engine";
import { uploadPublicAsset } from "@/lib/storage";

interface SingleImageInput {
  postId: string;
  title: string;
  editorialPillar?: string;
  imagePrompt: string;
}

export type ImageAssetInput = SingleImageInput;
/**
 * Images are generated without an inference call. Unsplash is used when
 * configured; otherwise @vercel/og/Satori creates a deterministic card.
 */
export async function generateSingleImageAsset(input: SingleImageInput): Promise<string> {
  let background: Buffer | null = null;
  const stockQuery = `${input.title} technology workspace data engineering`;
  const stockUrl = wantsRealPhotography(input.imagePrompt) ? await fetchStockImageUrl(stockQuery) : null;

  if (stockUrl) {
    try {
      const response = await fetch(stockUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (response.ok) background = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      console.warn("Fallback fotografico indisponivel; usando Satori:", error);
    }
  }

  if (!background) {
    const card = await generateImageZeroCost(input.title, input.editorialPillar ?? "TECH · DATA · GROWTH");
    const safeName = encodeURIComponent(input.title).slice(0, 120);
    return uploadPublicAsset(`linkedin-posts/${input.postId}-${safeName}-zero-cost.png`, card, "image/png");
  }

  const safeName = encodeURIComponent(input.title).slice(0, 120);
  const backgroundUrl = await uploadPublicAsset(`linkedin-posts/${input.postId}-${safeName}-background.png`, background, "image/png");
  const params = new URLSearchParams({
    background: backgroundUrl,
    title: input.title,
    pillar: input.editorialPillar ?? "TECH · DATA · GROWTH",
  });
  const response = await fetch(`${getAppUrl()}/api/og/creative?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Falha ao compor texto deterministico do criativo: ${response.status}`);
  const finalImage = new Uint8Array(await response.arrayBuffer());
  return uploadPublicAsset(`linkedin-posts/${input.postId}-${safeName}-final.png`, finalImage, "image/png");
}

/**
 * Image boundary used by the content engine. The primary path may use a stock
 * photo or Satori; the second attempt always uses the deterministic zero-cost
 * renderer so a transient remote image failure does not lose the post.
 */
export async function generateImageWithFallback(input: SingleImageInput): Promise<string> {
  try {
    return await generateSingleImageAsset(input);
  } catch (error) {
    console.error("[creative-renderer] primary image generation failed; using zero-cost fallback", {
      postId: input.postId,
      error: error instanceof Error ? error.message : String(error),
    });
    const card = await generateImageZeroCost(input.title, input.editorialPillar ?? "TECH · DATA · GROWTH");
    const safeName = encodeURIComponent(input.title).slice(0, 120);
    return uploadPublicAsset(`linkedin-posts/${input.postId}-${safeName}-fallback.png`, card, "image/png");
  }
}
