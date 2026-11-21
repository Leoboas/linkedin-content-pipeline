import { inflateRawSync } from "node:zlib";

export const ANALYTICS_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 24 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;

export type AnalyticsImportRow = { rowNumber: number; values: Record<string, string> };
export type ParsedAnalyticsFile = { headers: string[]; rows: AnalyticsImportRow[] };

function decodeXml(value: string): string {
  return value.replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'").replace(/&amp;/gu, "&");
}

function parseCsv(text: string): ParsedAnalyticsFile {
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === "," || char === ";" || char === "\t") {
      row.push(cell); cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) matrix.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) matrix.push(row);
  if (matrix.length < 2) throw new Error("O CSV precisa conter cabeçalho e ao menos uma linha de dados.");
  const headers = matrix[0]!.map((value, index) => value.trim() || `column_${index + 1}`);
  return {
    headers,
    rows: matrix.slice(1).map((values, index) => ({
      rowNumber: index + 2,
      values: Object.fromEntries(headers.map((header, column) => [header, (values[column] ?? "").trim()])),
    })),
  };
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const minimum = Math.max(0, buffer.length - 65_557);
  let end = -1;
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error("Arquivo XLSX inválido: diretório ZIP ausente.");
  const entryCount = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  let offset = buffer.readUInt32LE(end + 16);
  if (entryCount > MAX_ZIP_ENTRIES || offset + directorySize > buffer.length) throw new Error("Arquivo XLSX excede os limites de segurança.");
  const entries = new Map<string, Buffer>();
  let totalSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Diretório ZIP XLSX inválido.");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength).replaceAll("\\", "/");
    offset += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new Error("XLSX criptografado não é suportado.");
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("Caminho inválido dentro do XLSX.");
    if (!name || name.endsWith("/")) continue;
    if (uncompressedSize > MAX_UNCOMPRESSED_BYTES || (totalSize += uncompressedSize) > MAX_UNCOMPRESSED_BYTES) {
      throw new Error("Conteúdo descompactado do XLSX excede 24 MB.");
    }
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Entrada ZIP XLSX inválida.");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (dataStart + compressedSize > buffer.length) throw new Error("Dados truncados no XLSX.");
    let data: Buffer;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
    else throw new Error(`Método de compactação XLSX não suportado: ${method}.`);
    if (data.length !== uncompressedSize) throw new Error("Tamanho XLSX descompactado não confere.");
    entries.set(name, data);
  }
  return entries;
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/iu)?.[0]?.toUpperCase() ?? "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function firstWorksheetPath(entries: Map<string, Buffer>): string {
  const fallback = [...entries.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name)).sort()[0];
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8");
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  const relationshipId = workbook?.match(/<sheet\b[^>]*\br:id="([^"]+)"/u)?.[1];
  if (!relationshipId || !rels) {
    if (fallback) return fallback;
    throw new Error("Nenhuma planilha foi encontrada no XLSX.");
  }
  const relation = [...rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/gu)].map((match) => match[1] ?? "")
    .find((attrs) => new RegExp(`\\bId="${relationshipId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}"`, "u").test(attrs));
  const target = relation?.match(/\bTarget="([^"]+)"/u)?.[1];
  if (!target) throw new Error("A primeira planilha XLSX não possui relação válida.");
  const normalized = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  const resolved = parts.join("/");
  if (!entries.has(resolved)) throw new Error("O conteúdo da primeira planilha XLSX não foi encontrado.");
  return resolved;
}

function parseXlsx(buffer: Buffer): ParsedAnalyticsFile {
  const entries = readZipEntries(buffer);
  const worksheet = entries.get(firstWorksheetPath(entries))?.toString("utf8");
  if (!worksheet) throw new Error("Planilha XLSX vazia.");
  const sharedStrings = entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = [...sharedStrings.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)].map((match) =>
    [...(match[1] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map((text) => decodeXml(text[1] ?? "")).join(""));
  const matrix: Array<{ rowNumber: number; cells: string[] }> = [];
  for (const rowMatch of worksheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gu)) {
    const rowNumber = Number(rowMatch[1]?.match(/\br="(\d+)"/u)?.[1] ?? matrix.length + 1);
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/iu)?.[1] ?? "A1";
      const index = columnIndex(ref);
      const type = attrs.match(/\bt="([^"]+)"/u)?.[1];
      const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/u)?.[1];
      const inline = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map((match) => decodeXml(match[1] ?? "")).join("");
      const value = type === "s" && raw !== undefined ? shared[Number(raw)] ?? ""
        : type === "inlineStr" ? inline : raw === undefined ? inline : decodeXml(raw);
      cells[index] = value;
    }
    matrix.push({ rowNumber, cells });
  }
  if (matrix.length < 2) throw new Error("O XLSX precisa conter cabeçalho e ao menos uma linha de dados.");
  const headerRow = matrix[0]!;
  const width = Math.max(...matrix.map((row) => row.cells.length));
  const headers = Array.from({ length: width }, (_, index) => headerRow.cells[index]?.trim() || `column_${index + 1}`);
  return {
    headers,
    rows: matrix.slice(1).map(({ rowNumber, cells }) => ({
      rowNumber,
      values: Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? "").trim()])),
    })),
  };
}

export function parseAnalyticsFile(buffer: Buffer, fileName: string): ParsedAnalyticsFile {
  if (buffer.byteLength === 0 || buffer.byteLength > ANALYTICS_IMPORT_MAX_BYTES) throw new Error("Arquivo vazio ou maior que o limite de 4 MB.");
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "csv") return parseCsv(buffer.toString("utf8"));
  if (extension === "xlsx") return parseXlsx(buffer);
  throw new Error("Formato não suportado. Envie CSV ou XLSX.");
}

const HEADER_ALIASES: Record<string, string[]> = {
  linkedinPostId: ["linkedin post id", "post urn", "urn", "post id", "activity id"],
  postUrl: ["post url", "url", "link"],
  title: ["post title", "title", "post name", "publicação", "titulo"],
  publishedAt: ["published at", "publication date", "post date", "data da publicação", "data de publicação"],
  capturedAt: ["captured at", "report date", "data de referência", "data do relatório"],
  impressions: ["impressions", "impressions total", "impressões", "visualizações"],
  membersReached: ["members reached", "unique viewers", "members reached total", "pessoas alcançadas", "alcance"],
  impressionsInNetwork: ["in-network impressions", "impressions in network", "impressões na rede"],
  impressionsOutOfNetwork: ["out-of-network impressions", "impressions outside network", "impressões fora da rede"],
  inNetworkPercent: ["in-network percentage", "in network %", "% dentro da rede"],
  outOfNetworkPercent: ["out-of-network percentage", "outside network %", "% fora da rede"],
  reactions: ["reactions", "reactions total", "reações"],
  comments: ["comments", "comments total", "comentários"],
  shares: ["reposts", "shares", "reshare", "compartilhamentos"],
  postSaves: ["saves", "saved", "saves total", "salvamentos"],
  postSends: ["sends", "sent", "envios"],
  linkClicks: ["link clicks", "clicks", "cliques no link"],
  followersGained: ["followers gained", "new followers", "seguidores ganhos"],
  profileViewsFromContent: ["profile views from post", "profile views from content", "visitas ao perfil pelo post"],
  measurementWindow: ["measurement window", "period", "window", "janela"],
};

function normalizedHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9%]+/gu, " ").trim();
}

export function suggestAnalyticsColumnMapping(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const normalizedAliases = aliases.map(normalizedHeader);
    const match = headers.find((header) => normalizedAliases.includes(normalizedHeader(header)));
    if (match) result[field] = match;
  }
  return result;
}

export function parseImportedMetric(value: string, percent = false): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const clean = trimmed.replace(/\s/gu, "").replace(/%$/u, "");
  const separators = [...clean.matchAll(/[.,]/gu)].map((match) => match.index!);
  const numeric = clean.includes(",") && clean.includes(".")
    ? (clean.lastIndexOf(",") > clean.lastIndexOf(".") ? clean.replaceAll(".", "").replace(",", ".") : clean.replaceAll(",", ""))
    : !percent && separators.length > 1 && /^[+-]?\d{1,3}(?:[.,]\d{3})+$/u.test(clean)
      ? clean.replace(/[.,]/gu, "")
      : !percent && separators.length === 1 && /^[+-]?\d{1,3}[.,]\d{3}$/u.test(clean)
        ? clean.replace(/[.,]/u, "")
        : clean.includes(",") ? clean.replace(",", ".") : clean;
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed) || parsed < 0 || (!percent && !Number.isSafeInteger(parsed)) || (percent && parsed > 100)) {
    throw new Error(`Valor numérico inválido: ${value}`);
  }
  return percent ? Number(parsed.toFixed(3)) : parsed;
}

export function resolveAnalyticsPostByLinkedInId<T extends { linkedinPostId: string | null }>(
  externalId: string,
  publishedPosts: readonly T[],
): T | null {
  const id = externalId.trim();
  return id ? publishedPosts.find((post) => post.linkedinPostId === id) ?? null : null;
}

export function analyticsImportIdempotencyKey(input: { fileSha256: string; rowNumber: number }): string {
  return `IMPORT:${input.fileSha256}:${input.rowNumber}`;
}
