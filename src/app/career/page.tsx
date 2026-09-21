import { CareerDashboard, type CareerDashboardData } from "./CareerDashboard";
import { cookies } from "next/headers";
import { DashboardLogin } from "@/app/auth/DashboardLogin";
import { isDashboardSessionValid, DASHBOARD_SESSION_COOKIE } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

export default async function CareerPage() {
  const cookieStore = await cookies();
  if (!isDashboardSessionValid(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value)) return <DashboardLogin nextPath="/career" />;
  const empty: CareerDashboardData = { profile: null, matches: [], radar: [], audit: null };
  return <CareerDashboard initialData={empty} />;
}
