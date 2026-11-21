import { cookies } from "next/headers";
import { DashboardLogin } from "@/app/auth/DashboardLogin";
import { DASHBOARD_SESSION_COOKIE, isDashboardSessionValid } from "@/lib/dashboard-auth";
import { AdminNav } from "../AdminNav";
import { NetworkingStudio } from "./NetworkingStudio";

export const dynamic = "force-dynamic";

export default async function NetworkingPage() {
  const cookieStore = await cookies();
  if (!isDashboardSessionValid(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value)) return <DashboardLogin nextPath="/admin/networking" />;
  return <main className="admin-shell"><div className="admin-container">
    <AdminNav current="networking" />
    <header className="admin-header"><div><div className="admin-kicker">Networking manual · discussão útil · histórico real</div><h1>Networking Intelligence</h1><p>Descubra conversas, prepare contribuições técnicas e acompanhe interações confirmadas. Nenhuma ação é executada no LinkedIn.</p></div></header>
    <NetworkingStudio />
  </div></main>;
}
