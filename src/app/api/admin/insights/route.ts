import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { getAnalyticsDashboard, type AnalyticsWindow } from "@/lib/analytics-dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const now = new Date();
  const to = url.searchParams.has("to") ? new Date(`${url.searchParams.get("to")}T23:59:59.999Z`) : now;
  const from = url.searchParams.has("from") ? new Date(`${url.searchParams.get("from")}T00:00:00.000Z`) : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const rawWindow = url.searchParams.get("window") ?? "7D";
  const window: AnalyticsWindow = ["24H", "72H", "7D", "LIFETIME", "BEST_AVAILABLE"].includes(rawWindow) ? rawWindow as AnalyticsWindow : "7D";
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "Informe intervalo válido de até 366 dias." }, { status: 400 });
  }
  return NextResponse.json(await getAnalyticsDashboard({ from, to, window }), { headers: { "Cache-Control": "no-store" } });
}
