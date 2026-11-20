import { ImageResponse } from "@vercel/og";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  }
}

const accents = ["#2563eb", "#7c3aed", "#059669", "#d97706"];

export function GET(request: Request): ImageResponse {
  const params = new URL(request.url).searchParams;
  const title = params.get("title") ?? "Insight de engenharia";
  const bullets = parseList(params.get("content"));
  const page = params.get("page") ?? "1";
  const pageCount = params.get("pageCount") ?? "1";
  const pillar = params.get("pillar") ?? "TECH · DATA · GROWTH";
  const code = params.get("code");
  const metrics = parseList(params.get("metrics"));

  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "48px 64px 42px", background: "#f8fafc", color: "#172554", fontFamily: "Arial" }}>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 26, borderBottom: "1px solid #cbd5e1" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", color: "#4f46e5", fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>{pillar.toUpperCase()}</div>
          <div style={{ display: "flex", fontSize: 48, lineHeight: 1.08, fontWeight: 800, marginTop: 12 }}>{title}</div>
          <div style={{ display: "flex", fontSize: 24, color: "#475569", marginTop: 14 }}>Decisões de arquitetura · Trade-offs técnicos · Resultado prático</div>
        </div>
        <div style={{ display: "flex", color: "#64748b", fontSize: 24, fontWeight: 700 }}>{page}/{pageCount}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 18, marginTop: 30 }}>
        {bullets.map((bullet, index) => (
          <div key={`${bullet}-${index}`} style={{ display: "flex", flexDirection: "column", width: "44%", padding: "22px 26px", borderRadius: 16, border: `2px solid ${accents[index % accents.length]}55`, background: "#ffffff" }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 14, color: accents[index % accents.length], fontSize: 20, fontWeight: 800 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 17, background: accents[index % accents.length], color: "#ffffff", fontSize: 18 }}>{index + 1}</div>
              <div style={{ display: "flex" }}>{["Contexto", "Decisão", "Implementação", "Impacto"][index % 4]}</div>
            </div>
            <div style={{ display: "flex", fontSize: 27, lineHeight: 1.25, color: "#1e293b", marginTop: 14 }}>{bullet}</div>
          </div>
        ))}
      </div>
      {code ? <div style={{ display: "flex", marginTop: 18, padding: "16px 22px", borderRadius: 12, background: "#172554", color: "#dbeafe", fontSize: 20 }}>{code}</div> : null}
      {metrics.length > 0 ? <div style={{ display: "flex", flexDirection: "row", gap: 14, marginTop: 18 }}>{metrics.map((metric) => <div key={metric} style={{ display: "flex", padding: "12px 18px", borderRadius: 10, background: "#dbeafe", color: "#1e3a8a", fontSize: 22, fontWeight: 700 }}>{metric}</div>)}</div> : null}
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", color: "#64748b", fontSize: 18, marginTop: 22 }}><div style={{ display: "flex" }}>LinkedIn · {page}/{pageCount}</div></div>
    </div>,
    { width: 1600, height: 900 },
  );
}
