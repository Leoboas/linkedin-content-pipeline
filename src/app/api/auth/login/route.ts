import { NextResponse } from "next/server";
import { createDashboardSession, dashboardCredentialsMatch, DASHBOARD_SESSION_COOKIE } from "@/lib/dashboard-auth";

export async function POST(request: Request): Promise<NextResponse> {
  let body: { username?: unknown; password?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400 }); }
  if (typeof body.username !== "string" || typeof body.password !== "string") return NextResponse.json({ error: "Informe usuário e senha." }, { status: 400 });
  if (!process.env.DASHBOARD_ADMIN_USERNAME || !process.env.DASHBOARD_ADMIN_PASSWORD || !process.env.DASHBOARD_SESSION_SECRET) {
    return NextResponse.json({ error: "Credenciais do Dashboard não configuradas no ambiente." }, { status: 503 });
  }
  if (!dashboardCredentialsMatch(body.username, body.password)) return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(DASHBOARD_SESSION_COOKIE, createDashboardSession(body.username), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
  return response;
}
