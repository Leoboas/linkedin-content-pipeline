import { put } from "@vercel/blob";
import { Buffer } from "node:buffer";

function requireBlobToken(): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN não configurado; não é possível persistir a mídia.");
  }
}

export async function uploadPublicAsset(
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<string> {
  requireBlobToken();
  const blob = await put(path, Buffer.from(body), {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });
  return blob.url;
}
