import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const triggeredAt = new URL(request.url).searchParams.get("triggeredAt") ?? new Date().toISOString();
  await inngest.send({
    name: "posts/generate.weekly",
    data: { triggeredAt },
  });
  return NextResponse.json({ accepted: true });
}
