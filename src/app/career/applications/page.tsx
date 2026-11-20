import { cookies } from "next/headers";
import { DashboardLogin } from "@/app/auth/DashboardLogin";
import { isDashboardSessionValid, DASHBOARD_SESSION_COOKIE } from "@/lib/dashboard-auth";
import { ApplicationTracker } from "../ApplicationTracker";

export const dynamic = "force-dynamic";

export default async function CareerApplicationsPage() {
  const cookieStore = await cookies();
  if (!isDashboardSessionValid(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value)) return <DashboardLogin nextPath="/career/applications" />;
  return <ApplicationTracker token="session" />;
}
