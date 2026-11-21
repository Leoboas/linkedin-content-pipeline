import Link from "next/link";

export function AdminNav({ current }: { current: "agenda" | "skills" | "career" | "analytics" | "applications" | "networking" | "experimentation" }) {
  return <nav className="admin-nav" aria-label="Navegação principal">
    <Link className={current === "agenda" ? "active" : ""} href="/admin">Agenda e posts</Link>
    <Link className={current === "analytics" ? "active" : ""} href="/admin/analytics">Analytics</Link>
    <Link className={current === "experimentation" ? "active" : ""} href="/admin/experimentation">Experimentos & carreira</Link>
    <Link className={current === "networking" ? "active" : ""} href="/admin/networking">Networking</Link>
    <Link className={current === "skills" ? "active" : ""} href="/admin/skills">Skills LinkedIn</Link>
    <Link className={current === "career" ? "active" : ""} href="/career">Carreira e vagas</Link>
    <Link className={current === "applications" ? "active" : ""} href="/career/applications">Candidaturas</Link>
  </nav>;
}
