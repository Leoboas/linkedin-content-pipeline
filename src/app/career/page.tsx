import { CareerDashboard, type CareerDashboardData } from "./CareerDashboard";

export const dynamic = "force-dynamic";

export default async function CareerPage() {
  const empty: CareerDashboardData = { profile: null, matches: [], radar: [], audit: null };
  return <CareerDashboard initialData={empty} />;
}
