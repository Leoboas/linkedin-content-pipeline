import { generateCreativeImage } from "@/lib/huggingface";
import { getAppUrl } from "@/lib/app-url";
import { fetchStockImageUrl, wantsRealPhotography } from "@/lib/image-prompt-engine";
import { uploadPublicAsset } from "@/lib/storage";

interface SingleImageInput {
  postId: string;
  title: string;
  editorialPillar?: string;
  imagePrompt: string;
}

/**
 * FLUX generates the visual plate. Satori renders the final copy so accents,
 * numbers and line breaks are deterministic and readable.
 */
export async function generateSingleImageAsset(input: SingleImageInput): Promise<string> {
  const backgroundPrompt = [
    input.imagePrompt,
    "Generate only a clean visual background plate with no text, letters, numbers, logos or symbols.",
    "Leave a calm, high-contrast lower area for a programmatic title overlay.",
  ].join(" ");
  let background: Buffer;
  const stockQuery = `${input.title} technology workspace data engineering`;
  const stockUrl = wantsRealPhotography(input.imagePrompt) ? await fetchStockImageUrl(stockQuery) : null;
  if (stockUrl) {
    const response = await fetch(stockUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Fallback fotográfico retornou ${response.status}.`);
    background = Buffer.from(await response.arrayBuffer());
  } else {
    try {
      background = await generateCreativeImage(backgroundPrompt);
    } catch (error) {
      const fallbackUrl = await fetchStockImageUrl(stockQuery);
      if (!fallbackUrl) throw error;
      const response = await fetch(fallbackUrl, { cache: "no-store" });
      if (!response.ok) throw error;
      background = Buffer.from(await response.arrayBuffer());
    }
  }
  const safeName = encodeURIComponent(input.title).slice(0, 120);
  const backgroundUrl = await uploadPublicAsset(`linkedin-posts/${input.postId}-${safeName}-background.png`, background, "image/png");
  const params = new URLSearchParams({
    background: backgroundUrl,
    title: input.title,
    pillar: input.editorialPillar ?? "TECH · DATA · GROWTH",
  });
  const response = await fetch(`${getAppUrl()}/api/og/creative?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Falha ao compor texto determinístico do criativo: ${response.status}`);
  const finalImage = new Uint8Array(await response.arrayBuffer());
  return uploadPublicAsset(`linkedin-posts/${input.postId}-${safeName}-final.png`, finalImage, "image/png");
}
