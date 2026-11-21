import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { metricAvailabilityForFields, measurementWindowLateness, observedInteractionRate } from "@/lib/analytics-data";
import { analyticsImportIdempotencyKey, parseAnalyticsFile, parseImportedMetric, resolveAnalyticsPostByLinkedInId, suggestAnalyticsColumnMapping } from "@/lib/analytics-import";
import { prisma } from "@/lib/prisma";
import { recordExperimentEvaluationsForPost } from "@/lib/experimentation-persistence";

export const runtime = "nodejs";
export const maxDuration = 30;

const METRIC_COLUMNS = [
  "impressions", "membersReached", "impressionsInNetwork", "impressionsOutOfNetwork",
  "inNetworkPercent", "outOfNetworkPercent", "reactions", "comments", "shares", "postSaves",
  "postSends", "linkClicks", "followersGained", "profileViewsFromContent",
] as const;
const PERCENT_COLUMNS = new Set(["inNetworkPercent", "outOfNetworkPercent"]);

function jsonObject(value: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function rowString(row: Record<string, string>, mapping: Record<string, unknown>, field: string): string {
  const header = mapping[field];
  return typeof header === "string" ? row[header] ?? "" : "";
}

function parseDate(value: string): Date | null {
  if (!value.trim()) return null;
  if (/^\d+(?:\.\d+)?$/u.test(value.trim())) {
    const serial = Number(value);
    if (serial >= 20_000 && serial <= 80_000) return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Data inválida: ${value}`);
  return parsed;
}

function serializeMetricValue(row: Record<string, string>, mapping: Record<string, unknown>): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  for (const field of METRIC_COLUMNS) {
    const raw = rowString(row, mapping, field);
    values[field] = raw ? parseImportedMetric(raw, PERCENT_COLUMNS.has(field)) : null;
  }
  if (Object.values(values).every((value) => value === null)) throw new Error("A linha não possui métricas numéricas mapeadas.");
  return values;
}

function audienceBreakdown(row: Record<string, string>, mapping: Record<string, unknown>): Prisma.InputJsonObject | undefined {
  const audience: Record<string, string> = {};
  for (const field of ["audienceCountry", "audienceRole", "audienceSeniority", "audienceIndustry"] as const) {
    const value = rowString(row, mapping, field).trim();
    if (value) audience[field] = value;
  }
  return Object.keys(audience).length ? audience : undefined;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const posts = await prisma.post.findMany({
    where: { status: "PUBLISHED", publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" }, take: 300,
    select: { id: true, title: true, publishedAt: true, linkedinPostId: true, language: true, formatType: true },
  });
  return NextResponse.json({ posts }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Selecione um arquivo CSV ou XLSX." }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseAnalyticsFile(buffer, file.name);
    if (parsed.rows.length > 5_000) return NextResponse.json({ error: "Limite de 5.000 linhas por arquivo." }, { status: 413 });
    const mapping = jsonObject(form.get("mapping"));
    const associations = jsonObject(form.get("associations"));
    const mode = form.get("mode") === "import" ? "import" : "preview";
    const candidates = await prisma.post.findMany({
      where: { status: "PUBLISHED", publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" }, take: 300,
      select: { id: true, title: true, publishedAt: true, linkedinPostId: true, language: true, formatType: true },
    });
    const suggestedMapping = suggestAnalyticsColumnMapping(parsed.headers);
    if (mode === "preview") {
      return NextResponse.json({
        fileName: file.name,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        headers: parsed.headers,
        suggestedMapping,
        mappingFields: [...METRIC_COLUMNS, "linkedinPostId", "postUrl", "title", "publishedAt", "capturedAt", "measurementWindow", "audienceCountry", "audienceRole", "audienceSeniority", "audienceIndustry"],
        rows: parsed.rows,
        posts: candidates,
        totalRows: parsed.rows.length,
      });
    }

    for (const [field, header] of Object.entries(mapping)) {
      if (typeof header !== "string" || !parsed.headers.includes(header)) {
        return NextResponse.json({ error: `Coluna mapeada inválida para ${field}.` }, { status: 400 });
      }
    }
    for (const field of METRIC_COLUMNS) {
      const header = mapping[field];
      if (header !== undefined && (typeof header !== "string" || !parsed.headers.includes(header))) {
        return NextResponse.json({ error: `Coluna mapeada inválida para ${field}.` }, { status: 400 });
      }
    }
    const fileSha256 = createHash("sha256").update(buffer).digest("hex");
    const existing = await prisma.analyticsImportBatch.findUnique({ where: { fileSha256 } });

    const linkedIdField = mapping.linkedinPostId;
    const associationByPostId = new Map(candidates.map((post) => [post.id, post]));
    const associationForRow: Array<{ rowNumber: number; post: typeof candidates[number] | null; values: Record<string, number | null>; capturedAt: Date; window: string; audience?: Prisma.InputJsonObject }> = [];
    const errorRows: Array<{ rowNumber: number; reason: string }> = [];
    const aggregateRows: Array<{ rowNumber: number; metrics: Record<string, number | null> }> = [];
    const seenPostWindows = new Set<string>();
    const windowValues = new Set(["24H", "72H", "7D", "LIFETIME"]);
    const importedAt = new Date();

    for (const item of parsed.rows) {
      try {
        const values = serializeMetricValue(item.values, mapping);
        const manualPostId = associations[String(item.rowNumber)];
        if (typeof manualPostId === "string" && manualPostId && !associationByPostId.has(manualPostId)) throw new Error("Associação manual aponta para um post não publicado ou inexistente.");
        let post = typeof manualPostId === "string" ? associationByPostId.get(manualPostId) ?? null : null;
        const rawLinkedInId = typeof linkedIdField === "string" ? item.values[linkedIdField]?.trim() : "";
        if (!post && rawLinkedInId) post = resolveAnalyticsPostByLinkedInId(rawLinkedInId, candidates);
        const rawCapturedAt = rowString(item.values, mapping, "capturedAt");
        const capturedAt = parseDate(rawCapturedAt) ?? importedAt;
        const mappedWindow = rowString(item.values, mapping, "measurementWindow").trim().toUpperCase();
        const requestedWindow = typeof form.get("measurementWindow") === "string" ? String(form.get("measurementWindow")).toUpperCase() : "";
        const window = windowValues.has(mappedWindow) ? mappedWindow : windowValues.has(requestedWindow) ? requestedWindow : "LIFETIME";
        if (!post) {
          aggregateRows.push({ rowNumber: item.rowNumber, metrics: values });
          associationForRow.push({ rowNumber: item.rowNumber, post: null, values, capturedAt, window, audience: audienceBreakdown(item.values, mapping) });
          continue;
        }
        if (post.publishedAt && capturedAt < post.publishedAt) throw new Error("A data da métrica é anterior à publicação real do post.");
        const duplicateKey = `${post.id}:${window}`;
        if (seenPostWindows.has(duplicateKey)) throw new Error("Mais de uma linha aponta para o mesmo post e janela; associe somente uma linha por combinação.");
        seenPostWindows.add(duplicateKey);
        associationForRow.push({ rowNumber: item.rowNumber, post, values, capturedAt, window, audience: audienceBreakdown(item.values, mapping) });
      } catch (error) {
        errorRows.push({ rowNumber: item.rowNumber, reason: error instanceof Error ? error.message : "Linha inválida." });
      }
    }

    const mappedRows = associationForRow.filter((row) => row.post);
    const sourceLabel = typeof form.get("sourceLabel") === "string" ? String(form.get("sourceLabel")).trim().slice(0, 200) : "LinkedIn Analytics export";
    if (!sourceLabel) return NextResponse.json({ error: "Informe a origem do relatório." }, { status: 400 });
    const mappingJson = JSON.parse(JSON.stringify(mapping)) as Prisma.InputJsonObject;
    let result: { batch: { id: string }; imported: number; unmatched: number; errorRows: Array<{ rowNumber: number; reason: string }>; postIds: string[] };
    try {
      result = await prisma.$transaction(async (tx) => {
      const revision = { importedAt: importedAt.toISOString(), columnMapping: mapping, associations, sourceLabel } as unknown as Prisma.InputJsonValue;
      const history = [...(Array.isArray(existing?.mappingHistory) ? existing.mappingHistory : []), revision] as Prisma.InputJsonArray;
      const batch = existing
        ? await tx.analyticsImportBatch.update({ where: { id: existing.id }, data: {
            fileName: file.name.slice(0, 500), sourceLabel,
            status: errorRows.length || aggregateRows.length ? "PARTIAL" : "COMPLETED",
            columnMapping: mappingJson, mappingHistory: history,
            rowsSeen: parsed.rows.length, rowsImported: mappedRows.length, rowsUnmatched: aggregateRows.length,
            errors: errorRows.length ? errorRows as unknown as Prisma.InputJsonArray : Prisma.DbNull,
            aggregateRows: aggregateRows.length ? aggregateRows as unknown as Prisma.InputJsonArray : Prisma.DbNull,
            capturedAt: importedAt,
          } })
        : await tx.analyticsImportBatch.create({ data: {
            fileName: file.name.slice(0, 500), fileSha256, sourceLabel,
            status: errorRows.length || aggregateRows.length ? "PARTIAL" : "COMPLETED",
            columnMapping: mappingJson, mappingHistory: history,
            rowsSeen: parsed.rows.length, rowsImported: mappedRows.length, rowsUnmatched: aggregateRows.length,
            errors: errorRows.length ? errorRows as unknown as Prisma.InputJsonArray : undefined,
            aggregateRows: aggregateRows.length ? aggregateRows as unknown as Prisma.InputJsonArray : undefined,
            capturedAt: importedAt,
          } });
      if (existing) await tx.postMetric.deleteMany({ where: { importBatchId: existing.id } });
      for (const row of mappedRows) {
        const post = row.post!;
        const expectedFields = METRIC_COLUMNS.filter((field) => typeof mapping[field] === "string");
        const availability = metricAvailabilityForFields(row.values, expectedFields);
        const interactionRate = observedInteractionRate({ impressions: row.values.impressions, reactions: row.values.reactions, comments: row.values.comments, shares: row.values.shares });
        const idempotencyKey = analyticsImportIdempotencyKey({ fileSha256, rowNumber: row.rowNumber });
        const create = {
          ...row.values,
          postId: post.id,
          linkedinPostId: post.linkedinPostId,
          publishedAtSnapshot: post.publishedAt,
          exposureHours: Number(((row.capturedAt.getTime() - post.publishedAt!.getTime()) / 3_600_000).toFixed(2)),
          latenessHours: measurementWindowLateness(row.window, (row.capturedAt.getTime() - post.publishedAt!.getTime()) / 3_600_000),
          source: file.name.toLowerCase().endsWith(".xlsx") ? "XLSX_IMPORT" : "CSV_IMPORT",
          sourceNote: sourceLabel,
          importBatchId: batch.id,
          importRowNumber: row.rowNumber,
          audienceBreakdown: row.audience,
          measurementWindow: row.window,
          availability,
          interactionRate,
          capturedAt: row.capturedAt,
          idempotencyKey,
        } satisfies Prisma.PostMetricUncheckedCreateInput;
        await tx.postMetric.upsert({
          where: { idempotencyKey }, create,
          update: create,
        });
      }
      return { batch, imported: mappedRows.length, unmatched: aggregateRows.length, errorRows, postIds: [...new Set(mappedRows.map((row) => row.post!.id))] };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const prior = await prisma.analyticsImportBatch.findUnique({ where: { fileSha256 } });
        if (prior) return NextResponse.json({ alreadyImported: true, batchId: prior.id, rowsImported: prior.rowsImported, rowsUnmatched: prior.rowsUnmatched });
      }
      throw error;
    }
    for (const postId of result.postIds) {
      try { await recordExperimentEvaluationsForPost(postId); }
      catch (error) { console.warn("[experimentation] imported metrics saved but evaluation refresh failed", error instanceof Error ? error.name : "unknown"); }
    }
    return NextResponse.json({
      alreadyImported: Boolean(existing),
      reimported: Boolean(existing),
      batchId: result.batch.id,
      rowsSeen: parsed.rows.length,
      rowsImported: result.imported,
      rowsUnmatched: result.unmatched,
      errors: result.errorRows,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name.startsWith("PrismaClient")) {
      console.error("[analytics-import] database operation failed", { kind: error.name, code: "code" in error ? error.code : undefined });
      return NextResponse.json({ error: "Falha ao persistir a importação de analytics. Nenhuma credencial foi exposta." }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "Falha ao processar importação.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
