import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Configure o DASHBOARD_ADMIN_TOKEN." }, { status: 401 });
  await inngest.send({ name: "career/scan.requested", data: { triggeredAt: new Date().toISOString() } });
  return NextResponse.json({ accepted: true, event: "career/scan.requested" }, { status: 202 });
}
