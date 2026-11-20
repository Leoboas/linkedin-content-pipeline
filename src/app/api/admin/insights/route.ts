import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { getPerformanceInsights } from "@/lib/performance-insights";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json(await getPerformanceInsights(), { headers: { "Cache-Control": "no-store" } });
}
