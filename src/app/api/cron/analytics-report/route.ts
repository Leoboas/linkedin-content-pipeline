import { NextResponse } from "next/server";
import { formatWeeklyPerformanceReport, getPerformanceInsights } from "@/lib/performance-insights";
import { sendTelegramText } from "@/lib/telegram";

export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const report = await getPerformanceInsights();
  await sendTelegramText(process.env.TELEGRAM_CHAT_ID ?? "", formatWeeklyPerformanceReport(report));
  return NextResponse.json({ sent: true, postsWithMetrics: report.postsWithMetrics, hypotheses: report.hypotheses.length });
}
