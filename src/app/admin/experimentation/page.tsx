import { cookies } from "next/headers";
import { DashboardLogin } from "@/app/auth/DashboardLogin";
import { DASHBOARD_SESSION_COOKIE, isDashboardSessionValid } from "@/lib/dashboard-auth";
import { AdminNav } from "../AdminNav";
import { EditorialExperimentationDashboard } from "./EditorialExperimentationDashboard";

export const dynamic = "force-dynamic";

export default async function EditorialExperimentationPage() {
  const cookieStore = await cookies();
  if (!isDashboardSessionValid(cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value)) return <DashboardLogin nextPath="/admin/experimentation" />;
  return <main className="admin-shell"><div className="admin-container"><AdminNav current="experimentation" /><header className="admin-header"><div className="admin-kicker">Ciclo de 90 dias · experimentos · impacto profissional</div><h1>Inteligência editorial</h1><p>Compare resultados observados, registre hipóteses e acompanhe sinais de carreira. Recomendações são explicáveis e sempre dependem de decisão humana.</p></header><EditorialExperimentationDashboard /></div></main>;
}
