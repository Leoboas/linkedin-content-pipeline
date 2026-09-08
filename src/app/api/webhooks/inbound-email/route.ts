import { NextResponse } from "next/server";
import { matchInboundJob } from "@/lib/job-matcher";
import { sendCareerJobAnalysis } from "@/lib/telegram";

function tokenMatches(received: string | null, expected: string | undefined): boolean {
  if (!received || !expected || received.length !== expected.length) return false;
  let result = 0;
  for (let index = 0; index < expected.length; index += 1) result |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  return result === 0;
}

function stripHtml(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function linkedinJobUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/(?:www\.)?linkedin\.com\/jobs\/[^\s<>'"\])]+/gi) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, "")))].slice(0, 10);
}

async function payloadFromRequest(request: Request): Promise<{ subject: string; body: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await request.json() as Record<string, unknown>;
    const subject = typeof payload.subject === "string" ? payload.subject : "";
    const body = [payload.text, payload.body, payload.html, payload.email].filter((value): value is string => typeof value === "string").join("\n");
    return { subject, body: stripHtml(body).slice(0, 100_000) };
  }
  const form = await request.formData();
  const subject = String(form.get("subject") ?? "");
  const body = ["text", "body", "html", "email"].map((key) => form.get(key)).filter((value): value is string => typeof value === "string").join("\n");
  return { subject, body: stripHtml(body).slice(0, 100_000) };
}

export async function POST(request: Request): Promise<NextResponse> {
  const expectedToken = process.env.INBOUND_EMAIL_TOKEN;
  if (!expectedToken) return NextResponse.json({ error: "INBOUND_EMAIL_TOKEN nao configurado." }, { status: 503 });
  const token = new URL(request.url).searchParams.get("token");
  if (!tokenMatches(token, expectedToken)) return NextResponse.json({ error: "Token invalido." }, { status: 401 });

  try {
    const payload = await payloadFromRequest(request);
    const urls = linkedinJobUrls(`${payload.subject}\n${payload.body}`);
    if (urls.length === 0) return NextResponse.json({ ok: true, received: 0, message: "Nenhuma URL de vaga do LinkedIn encontrada." });
    const results = [];
    let notified = 0;
    for (const url of urls) {
      try {
        const result = await matchInboundJob({ url, subject: payload.subject, body: payload.body });
        results.push({ url, jobId: result.jobId, score: result.score, isNew: result.isNew });
        if (result.isNew && result.score >= 75) {
          await sendCareerJobAnalysis(process.env.TELEGRAM_CHAT_ID ?? "", result);
          notified += 1;
        }
      } catch (error) {
        console.error("[inbound-email] falha ao processar vaga", { url, error: error instanceof Error ? error.message : String(error) });
        results.push({ url, error: error instanceof Error ? error.message : "Falha desconhecida" });
      }
    }
    return NextResponse.json({ ok: true, received: urls.length, analyzed: results.filter((item) => "score" in item).length, notified, results });
  } catch (error) {
    console.error("[inbound-email] payload invalido", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payload invalido." }, { status: 400 });
  }
}

