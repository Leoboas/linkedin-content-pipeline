import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  await inngest.send({ name: "career/search-links.requested", data: { triggeredAt: new Date().toISOString() } });
  await inngest.send({ name: "career/scan.requested", data: { triggeredAt: new Date().toISOString() } });
  return NextResponse.json({ accepted: true, events: ["career/search-links.requested", "career/scan.requested"] });
}
