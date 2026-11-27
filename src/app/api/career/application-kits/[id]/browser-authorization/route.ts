import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { getOrCreateProfile } from "@/lib/career-engine";
import { authorizeBrowserSubmission } from "@/lib/browser-application-executor";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const { id } = await context.params;
    const profile = await getOrCreateProfile();
    const result = await authorizeBrowserSubmission(id, profile.id);
    return NextResponse.json(result, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível autorizar a extensão." }, { status: 409 });
  }
}
