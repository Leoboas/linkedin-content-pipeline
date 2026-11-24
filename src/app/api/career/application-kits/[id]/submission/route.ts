import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { getOrCreateProfile } from "@/lib/career-engine";
import { authorizeSubmission, dispatchSubmission, inspectSubmissionKit } from "@/lib/career-submission";
import type { LeverAnswers } from "@/lib/lever-application";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const { id } = await context.params;
    const profile = await getOrCreateProfile();
    return NextResponse.json(await inspectSubmissionKit(id, profile.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Formulário indisponível." }, { status: 409 }); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const body = await request.json() as { formHash?: unknown; answers?: unknown };
    if (typeof body.formHash !== "string" || !/^[0-9a-f]{64}$/u.test(body.formHash) || !body.answers || typeof body.answers !== "object" || Array.isArray(body.answers) || Object.values(body.answers).some((v) => typeof v !== "string" && (!Array.isArray(v) || v.some((x) => typeof x !== "string")))) return NextResponse.json({ error: "Respostas inválidas." }, { status: 400 });
    const { id } = await context.params;
    const profile = await getOrCreateProfile();
    const submission = await authorizeSubmission(id, profile.id, body.formHash, body.answers as LeverAnswers);
    try { await dispatchSubmission(submission.id); } catch { /* Durable outbox is picked up by the scheduler. */ }
    return NextResponse.json({ submission }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível autorizar." }, { status: 409 }); }
}
