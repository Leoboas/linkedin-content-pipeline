import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { linkedinSearchQueries } from "@/lib/career-engine";
import { sendCareerSearchLinks } from "@/lib/telegram";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  // O painel de links Ã© enviado diretamente para nÃ£o depender da sincronizaÃ§Ã£o
  // do Inngest; o processamento e o digest de matches continuam no Inngest.
  await sendCareerSearchLinks(linkedinSearchQueries());
  await inngest.send({ name: "career/scan.requested", data: { triggeredAt: new Date().toISOString() } });
  return NextResponse.json({ accepted: true, linksSent: true, events: ["career/scan.requested"] });
}
