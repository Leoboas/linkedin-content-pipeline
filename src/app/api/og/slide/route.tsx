import { ImageResponse } from "@vercel/og";
import type { CSSProperties } from "react";

export const runtime = "edge";

function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  }
}

const column: CSSProperties = { display: "flex", flexDirection: "column" };
const accents = ["#2563eb", "#7c3aed", "#059669", "#d97706"];

export function GET(request: Request): ImageResponse {
  const params = new URL(request.url).searchParams;
  const title = params.get("title") ?? "Insight de engenharia";
  const bullets = parseList(params.get("content"));
  const code = params.get("code");
  const metrics = parseList(params.get("metrics"));
  const page = params.get("page") ?? "1";
  const pageCount = params.get("pageCount") ?? "1";
  const pillar = params.get("pillar") ?? "TECH · DATA · GROWTH";
  const architecture = params.get("layout") === "architecture";
  const width = architecture ? 1600 : 1080;
  const height = architecture ? 900 : 1350;

  return new ImageResponse(
    <div style={{ ...column, width: "100%", height: "100%", padding: architecture ? "48px 64px 42px" : "76px 84px", background: architecture ? "#f8fafc" : "#0b1020", color: architecture ? "#172554" : "#f8fafc", fontFamily: "Arial", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: architecture ? "1px solid #cbd5e1" : "none", paddingBottom: architecture ? 26 : 0 }}>
        <div style={{ ...column, maxWidth: architecture ? 1360 : 900 }}>
          <div style={{ color: architecture ? "#4f46e5" : "#38bdf8", fontSize: architecture ? 22 : 26, fontWeight: 700, letterSpacing: 2 }}>{pillar.toUpperCase()}</div>
          <div style={{ fontSize: architecture ? 48 : 64, lineHeight: 1.08, fontWeight: 800, marginTop: 12 }}>{title}</div>
          {architecture && <div style={{ fontSize: 24, color: "#475569", marginTop: 14 }}>Decisões de arquitetura · Trade-offs técnicos · Resultado prático</div>}
        </div>
        <div style={{ color: architecture ? "#64748b" : "#7dd3fc", fontSize: 24, fontWeight: 700 }}>{page}/{pageCount}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: architecture && bullets.length > 2 ? "1fr 1fr" : "1fr", gap: architecture ? 18 : 22, marginTop: architecture ? 30 : 62, flex: 1 }}>
        {bullets.map((bullet, index) => <div key={`${bullet}-${index}`} style={{ ...column, padding: architecture ? "22px 26px" : "0", borderRadius: architecture ? 16 : 0, border: architecture ? `2px solid ${accents[index % accents.length]}55` : "none", background: architecture ? "#ffffff" : "transparent", boxShadow: architecture ? "0 4px 14px #0f172a12" : "none" }}><div style={{ display: "flex", alignItems: "center", gap: 14, color: architecture ? accents[index % accents.length] : "#22d3ee", fontSize: architecture ? 20 : 32, fontWeight: 800 }}><span style={{ width: 34, height: 34, borderRadius: 17, background: accents[index % accents.length], color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{index + 1}</span><span>{architecture ? ["Contexto", "Decisão", "Implementação", "Impacto"][index % 4] : `0${index + 1}`}</span></div><div style={{ fontSize: architecture ? 27 : 32, lineHeight: 1.25, color: architecture ? "#1e293b" : "#f8fafc", marginTop: 14 }}>{bullet}</div></div>)}
      </div>
      {code ? <div style={{ ...column, marginTop: 18, padding: "16px 22px", borderRadius: 12, background: architecture ? "#172554" : "#111827", color: "#dbeafe", fontSize: 20, whiteSpace: "pre-wrap" }}>{code}</div> : null}
      {metrics.length > 0 ? <div style={{ display: "flex", gap: 14, marginTop: 18 }}>{metrics.map((metric) => <div key={metric} style={{ padding: "12px 18px", borderRadius: 10, background: architecture ? "#dbeafe" : "#164e63", color: architecture ? "#1e3a8a" : "#cffafe", fontSize: 22, fontWeight: 700 }}>{metric}</div>)}</div> : null}
      <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: 18, marginTop: 22 }}><span>Autonomous LinkedIn Content Engine</span><span>LinkedIn · {page}/{pageCount}</span></div>
    </div>,
    { width, height },
  );
}
