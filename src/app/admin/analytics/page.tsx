import { cookies } from "next/headers";
import { DashboardLogin } from "@/app/auth/DashboardLogin";
import { DASHBOARD_SESSION_COOKIE, isDashboardSessionValid } from "@/lib/dashboard-auth";
import { AdminNav } from "../AdminNav";
import { ProfileAnalyticsForm } from "./ProfileAnalyticsForm";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const cookieStore = await cookies();
  if (!isDashboardSessionValid(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value)) {
    return <DashboardLogin nextPath="/admin/analytics" />;
  }
  return <main className="admin-shell"><div className="admin-container"><AdminNav current="analytics" /><header className="admin-header"><div className="admin-kicker">Aprendizado baseado em observações</div><h1>Analytics do LinkedIn</h1><p>Importe métricas manualmente com período e origem explícitos. Valores indisponíveis devem ficar vazios, não ser estimados.</p></header><ProfileAnalyticsForm /></div></main>;
}
