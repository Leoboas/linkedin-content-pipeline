import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generatePremiumPostImage } from "@/lib/premium-image-engine";

async function loadEnvFile(filePath: string): Promise<void> {
  try {
    const text = await readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([^#=]+)=(.*)$/.exec(line);
      if (!match) continue;

      const name = match[1].trim();
      if (process.env[name] !== undefined) continue;
      process.env[name] = match[2].trim().replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function main(): Promise<void> {
  await loadEnvFile(".env.local");
  await loadEnvFile(".env");

  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new Error("GEMINI_API_KEY não está configurada em .env.local ou .env.");
  }

  const result = await generatePremiumPostImage("Arquitetura Observável na AWS", "BOFU");
  const publicDirectory = join(process.cwd(), "public");
  const outputPath = join(publicDirectory, "test-output.jpg");

  await mkdir(publicDirectory, { recursive: true });
  await writeFile(outputPath, result.buffer);

  console.log(`Imagem premium gerada por: ${result.provider}`);
  console.log(`Formato retornado: ${result.contentType}`);
  console.log(`Bytes gravados: ${result.buffer.byteLength}`);
  console.log(`Arquivo: ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error("Falha no teste de imagem premium:", error);
  process.exitCode = 1;
});
