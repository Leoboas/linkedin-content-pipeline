import { NextResponse } from "next/server";
import { getCareerDashboardData } from "@/lib/career-engine";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const data = await getCareerDashboardData();
  return NextResponse.json({ matches: data.matches, radar: data.radar, audit: data.audit });
}
