import { NextResponse } from "next/server";
import { claimBrowserExecutor, reportBrowserExecutor } from "@/lib/browser-application-executor";

export const runtime = "nodejs";
function bearer(request: Request) { const value = request.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7) : ""; }

export async function GET(request: Request) {
  try { return NextResponse.json(await claimBrowserExecutor(bearer(request)), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Executor indisponível." }, { status: 409 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { state?: unknown; reason?: unknown; evidence?: unknown };
    if (typeof body.state !== "string" || (body.reason !== undefined && typeof body.reason !== "string") || (body.evidence !== undefined && (!body.evidence || typeof body.evidence !== "object" || Array.isArray(body.evidence)))) return NextResponse.json({ error: "Relato da extensão inválido." }, { status: 400 });
    return NextResponse.json(await reportBrowserExecutor(bearer(request), { state: body.state, reason: body.reason, evidence: body.evidence as Record<string, unknown> | undefined }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível registrar a execução." }, { status: 409 }); }
}
