import mammoth from "mammoth";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_EXTRACTED_CHARS = 100_000;

export async function extractResumeText(bytes: Buffer, contentType: string): Promise<string> {
  let text = "";
  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const extracted = await mammoth.extractRawText({ buffer: bytes });
    text = extracted.value;
  } else if (contentType === "application/pdf") {
    const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
    try {
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.flatMap((item) => "str" in item && typeof item.str === "string" ? [item.str] : []).join(" "));
      }
      text = pages.join("\n");
    } finally {
      await document.cleanup();
    }
  } else {
    throw new Error("Formato de currículo não suportado.");
  }
  const normalized = text.replace(/\u0000/g, "").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_EXTRACTED_CHARS);
  if (normalized.length < 120) throw new Error("Não foi possível extrair texto suficiente do arquivo. Verifique se o documento não está protegido ou é uma imagem digitalizada.");
  return normalized;
}
