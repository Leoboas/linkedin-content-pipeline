import { cookies } from "next/headers";
import { DashboardLogin } from "@/app/auth/DashboardLogin";
import { DASHBOARD_SESSION_COOKIE, isDashboardSessionValid } from "@/lib/dashboard-auth";
import { AdminNav } from "@/app/admin/AdminNav";
import { SkillsDashboard } from "./SkillsDashboard";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const cookieStore = await cookies();
  if (!isDashboardSessionValid(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value)) return <DashboardLogin nextPath="/admin/skills" />;
  return <><div className="admin-container admin-top-nav"><AdminNav current="skills" /></div><SkillsDashboard /></>;
}
