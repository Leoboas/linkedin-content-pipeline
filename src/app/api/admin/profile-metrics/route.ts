import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { isValidProfileMetricValue, PROFILE_METRIC_TYPES, parseOptionalNonNegativeInteger, snapshotIdempotencyKey } from "@/lib/analytics-data";
import { prisma } from "@/lib/prisma";

const allowedMetrics = new Set<string>(PROFILE_METRIC_TYPES);

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400 }); }

  if (!Array.isArray(body.metrics) || body.metrics.length === 0) {
    return NextResponse.json({ error: "Envie metrics como uma lista de observações estruturadas." }, { status: 400 });
  }
  if (body.metrics.length > 20) return NextResponse.json({ error: "Limite de 20 métricas por importação." }, { status: 400 });
  const sourceNote = typeof body.sourceNote === "string" ? body.sourceNote.trim().slice(0, 500) : "LinkedIn Analytics UI";
  const capturedAt = new Date();
  const records: Prisma.ProfileMetricCreateManyInput[] = [];

  for (const item of body.metrics) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return NextResponse.json({ error: "Cada observação deve ser um objeto." }, { status: 400 });
    }
    const metric = item as Record<string, unknown>;
    const metricType = typeof metric.metricType === "string" ? metric.metricType.toUpperCase() : "";
    if (!allowedMetrics.has(metricType)) return NextResponse.json({ error: `Métrica de perfil não suportada: ${metricType || "vazia"}.` }, { status: 400 });
    const parsed = parseOptionalNonNegativeInteger(metric.value);
    if (!parsed.valid || parsed.value === null) return NextResponse.json({ error: `Valor inválido para ${metricType}.` }, { status: 400 });
    const periodStart = typeof metric.periodStart === "string" ? new Date(metric.periodStart) : null;
    const periodEnd = typeof metric.periodEnd === "string" ? new Date(metric.periodEnd) : null;
    if ((periodStart && Number.isNaN(periodStart.getTime())) || (periodEnd && Number.isNaN(periodEnd.getTime()))) {
      return NextResponse.json({ error: `Período inválido para ${metricType}.` }, { status: 400 });
    }
    if (periodStart && periodEnd && periodStart > periodEnd) {
      return NextResponse.json({ error: `Período inicial posterior ao período final para ${metricType}.` }, { status: 400 });
    }
    if (!isValidProfileMetricValue(metricType, parsed.value)) {
      return NextResponse.json({ error: metricType.endsWith("_PERCENT") ? `Percentual inválido para ${metricType}; use valor entre 0 e 100.` : `Valor inválido para ${metricType}.` }, { status: 400 });
    }
    const stableDate = periodEnd ?? capturedAt;
    records.push({
      metricType,
      value: parsed.value,
      source: "MANUAL",
      sourceNote,
      availability: "AVAILABLE",
      periodStart,
      periodEnd,
      capturedAt,
      idempotencyKey: snapshotIdempotencyKey(`profile:${metricType}`, "MANUAL", "DAILY", stableDate),
    });
  }

  const saved = await prisma.$transaction(records.map((record) => prisma.profileMetric.upsert({
    where: { idempotencyKey: record.idempotencyKey! },
    create: record,
    update: { value: record.value, sourceNote, periodStart: record.periodStart, periodEnd: record.periodEnd, capturedAt },
  })));
  return NextResponse.json({ saved: saved.length, source: "MANUAL", records: saved });
}
