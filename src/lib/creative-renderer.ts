import { getAppUrl } from "@/lib/app-url";
import { fetchStockImageUrl, generateImageZeroCost, wantsRealPhotography } from "@/lib/image-prompt-engine";
import { uploadPublicAsset } from "@/lib/storage";

interface SingleImageInput {
  postId: string;
  title: string;
  editorialPillar?: string;
  imagePrompt: string;
}
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
