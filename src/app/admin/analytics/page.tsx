import { cookies } from "next/headers";
import { DashboardLogin } from "@/app/auth/DashboardLogin";
import { DASHBOARD_SESSION_COOKIE, isDashboardSessionValid } from "@/lib/dashboard-auth";
import { AdminNav } from "../AdminNav";
import { ProfileAnalyticsForm } from "./ProfileAnalyticsForm";
import { PerformanceDashboard } from "./PerformanceDashboard";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const cookieStore = await cookies();
  if (!isDashboardSessionValid(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value)) {
    return <DashboardLogin nextPath="/admin/analytics" />;
  }
  return <main className="admin-shell"><div className="admin-container"><AdminNav current="analytics" /><header className="admin-header"><div className="admin-kicker">Performance observada · snapshots · descoberta qualificada</div><h1>Analytics do LinkedIn</h1><p>Compare publicações por janela de exposição, idioma e formato. A coleta automática só é habilitada quando a permissão oficial e o token válido são comprovados.</p></header><PerformanceDashboard /><ProfileAnalyticsForm /></div></main>;
}
