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

export function GET(request: Request): ImageResponse {
  const params = new URL(request.url).searchParams;
  const title = params.get("title") ?? "Insight de engenharia";
  const bullets = parseList(params.get("content"));
  const code = params.get("code");
  const metrics = parseList(params.get("metrics"));
  const page = params.get("page") ?? "1";
  const pageCount = params.get("pageCount") ?? "1";

  return new ImageResponse(
    <div
      style={{
        ...column,
        width: "100%",
        height: "100%",
        padding: "76px 84px",
        background: "#0b1020",
        color: "#f8fafc",
        fontFamily: "Arial",
        position: "relative",
      }}
    >
      <div style={{ ...column, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#7dd3fc", fontSize: 28 }}>
          <span>TECH LEADERSHIP · DATA · GROWTH</span>
          <span>{page}/{pageCount}</span>
        </div>
        <div style={{ ...column, marginTop: 92, maxWidth: 900 }}>
          <div style={{ color: "#38bdf8", fontSize: 26, marginBottom: 24 }}>INSIGHT PRÁTICO</div>
          <div style={{ fontSize: 64, lineHeight: 1.08, fontWeight: 700 }}>{title}</div>
        </div>
        <div style={{ ...column, marginTop: 62, gap: 22 }}>
          {bullets.map((bullet, index) => (
            <div key={`${bullet}-${index}`} style={{ display: "flex", fontSize: 32, lineHeight: 1.25 }}>
              <span style={{ color: "#22d3ee", marginRight: 18 }}>0{index + 1}</span>
              <span>{bullet}</span>
            </div>
          ))}
        </div>
        {code ? (
          <div
            style={{
              ...column,
              marginTop: 42,
              padding: "24px 28px",
              border: "1px solid #334155",
              borderRadius: 14,
              background: "#111827",
              color: "#bae6fd",
              fontSize: 24,
              whiteSpace: "pre-wrap",
            }}
          >
            {code}
          </div>
        ) : null}
        {metrics.length > 0 ? (
          <div style={{ display: "flex", gap: 18, marginTop: 42 }}>
            {metrics.map((metric) => (
              <div key={metric} style={{ padding: "16px 22px", borderRadius: 12, background: "#164e63", color: "#cffafe", fontSize: 26 }}>
                {metric}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: 24 }}>
        <span>linkedin content pipeline</span>
        <span>feito para compartilhar</span>
      </div>
    </div>,
    { width: 1080, height: 1350 },
  );
}
