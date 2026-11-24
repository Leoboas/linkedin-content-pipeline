import { ImageResponse } from "@vercel/og";
import React from "react";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Flow = { nodes: string[]; edges: Array<{ from: string; to: string; label?: string }>; scopeNote: string };
type Point = { x: number; y: number; width: number; height: number };

function clean(value: string | null, fallback: string, maxLength: number): string {
  return (value ?? fallback).replace(/[<>]/gu, "").trim().slice(0, maxLength) || fallback;
}

function isRemoteUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; }
  catch { return false; }
}

function parseFlow(value: string | null): Flow | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Flow>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges) || parsed.nodes.length < 2 || parsed.nodes.length > 6) return null;
    const nodes = parsed.nodes.filter((node): node is string => typeof node === "string" && !!node.trim()).map((node) => node.trim().slice(0, 34));
    const edges = parsed.edges.filter((edge): edge is Flow["edges"][number] => !!edge && typeof edge === "object" && typeof edge.from === "string" && typeof edge.to === "string" && nodes.includes(edge.from) && nodes.includes(edge.to)).slice(0, 8);
    if (nodes.length < 2 || edges.length < 1) return null;
    return { nodes, edges, scopeNote: typeof parsed.scopeNote === "string" ? parsed.scopeNote.trim().slice(0, 220) : "" };
  } catch { return null; }
}

function titleLines(value: string): string[] {
  const words = value.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > 31) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

function flowPoints(flow: Flow): Point[] {
  const lower = flow.nodes.map((node) => node.toLocaleLowerCase("pt-BR"));
  const bronze = lower.findIndex((node) => node.includes("bronze"));
  const validation = lower.findIndex((node) => node.includes("valida"));
  const silver = lower.findIndex((node) => node.includes("silver"));
  const quarantine = lower.findIndex((node) => node.includes("quarentena"));
  if (flow.nodes.length === 4 && [bronze, validation, silver, quarantine].every((index) => index >= 0)) {
    const points: Point[] = Array.from({ length: 4 }, () => ({ x: 0, y: 0, width: 240, height: 112 }));
    points[bronze] = { x: 12, y: 156, width: 238, height: 112 };
    points[validation] = { x: 345, y: 156, width: 246, height: 112 };
    points[silver] = { x: 690, y: 38, width: 232, height: 112 };
    points[quarantine] = { x: 690, y: 276, width: 232, height: 112 };
    return points;
  }
  const columns = flow.nodes.length <= 3 ? flow.nodes.length : 3;
  const width = 260;
  const gap = columns === 3 ? 40 : 165;
  return flow.nodes.map((_, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return { x: 12 + col * (width + gap), y: 48 + row * 178, width, height: 108 };
  });
}

export function GET(request: Request): ImageResponse {
  const params = new URL(request.url).searchParams;
  const background = params.get("background");
  const title = clean(params.get("title"), "Engineering insight", 140);
  const pillar = clean(params.get("pillar"), "TECH · DATA · ENGINEERING", 40).toUpperCase();
  const format = params.get("format") ?? "editorial-cover";
  const flow = parseFlow(params.get("flow"));
  if (background && !isRemoteUrl(background)) return new ImageResponse(<div />, { width: 1080, height: 1350, status: 400 });

  if (flow && (format === "architecture-infographic" || format === "carousel-slide")) {
    const points = flowPoints(flow);
    const edges = flow.edges.map((edge) => {
      const fromIndex = flow.nodes.indexOf(edge.from);
      const toIndex = flow.nodes.indexOf(edge.to);
      const from = points[fromIndex];
      const to = points[toIndex];
      const x1 = from.x + from.width;
      const y1 = from.y + from.height / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2 - 16;
      return <g key={`${edge.from}-${edge.to}`}>
        <path d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2 - 11} ${y2}`} fill="none" stroke="#38BDF8" strokeWidth="4" />
        <path d={`M ${x2 - 20} ${y2 - 8} L ${x2 - 8} ${y2} L ${x2 - 20} ${y2 + 8}`} fill="none" stroke="#38BDF8" strokeWidth="4" />
      </g>;
    });
    return new ImageResponse(
      <div style={{ display: "flex", position: "relative", width: "100%", height: "100%", background: "#0B1220", color: "#F8FAFC", fontFamily: "Arial" }}>
        {background ? <img src={background} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.1 }} /> : null}
        <div style={{ display: "flex", position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(15,23,42,.97), rgba(15,23,42,.9))" }} />
        <div style={{ display: "flex", position: "relative", flexDirection: "column", width: "100%", padding: "58px 72px 48px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#7DD3FC", fontSize: 19, letterSpacing: 2 }}><span>{pillar}</span><span>ENGINEERING FIELD NOTE</span></div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 56 }}>
            {titleLines(title).map((line, index) => <span key={`${line}-${index}`} style={{ display: "flex", fontSize: title.length > 80 ? 43 : 51, fontWeight: 700, lineHeight: 1.12 }}>{line}</span>)}
          </div>
          <div style={{ display: "flex", color: "#F59E0B", marginTop: 18, fontSize: 17, letterSpacing: 3 }}>FLUXO TÉCNICO</div>
          <div style={{ display: "flex", position: "relative", width: 936, height: 430, marginTop: 32 }}>
            <svg width="936" height="430" viewBox="0 0 936 430" style={{ position: "absolute", inset: 0 }}>{edges}</svg>
            {flow.edges.map((edge) => {
              if (!edge.label) return null;
              const from = points[flow.nodes.indexOf(edge.from)];
              const to = points[flow.nodes.indexOf(edge.to)];
              const left = Math.max(0, Math.min(856, (from.x + from.width + to.x) / 2 - 48));
              const top = Math.max(0, Math.min(405, (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 20));
              return <span key={`label-${edge.from}-${edge.to}`} style={{ display: "flex", position: "absolute", left, top, maxWidth: 96, padding: "4px 8px", borderRadius: 999, background: "#0B1220", border: "1px solid #F59E0B", color: "#FCD34D", fontSize: 12, textAlign: "center" }}>{edge.label.slice(0, 24)}</span>;
            })}
            {flow.nodes.map((node, index) => {
              const point = points[index];
              return <div key={`${node}-${index}`} style={{ display: "flex", position: "absolute", left: point.x, top: point.y, width: point.width, height: point.height, flexDirection: "column", justifyContent: "center", padding: "18px 20px", borderRadius: 18, border: `2px solid ${node.toLocaleLowerCase("pt-BR").includes("quarentena") ? "#F59E0B" : "#0EA5E9"}`, background: "#111E31", boxShadow: "0 12px 28px rgba(0,0,0,.25)" }}>
                <span style={{ display: "flex", color: "#94A3B8", fontSize: 14, letterSpacing: 2 }}>ETAPA {String(index + 1).padStart(2, "0")}</span>
                <span style={{ display: "flex", color: node.toLocaleLowerCase("pt-BR").includes("quarentena") ? "#FCD34D" : "#F8FAFC", fontSize: 23, fontWeight: 700, marginTop: 8 }}>{node}</span>
              </div>;
            })}
          </div>
          <div style={{ display: "flex", borderLeft: "4px solid #F59E0B", paddingLeft: 16, color: "#CBD5E1", fontSize: 17, lineHeight: 1.35, marginTop: 12 }}>{flow.scopeNote || "Fluxo representado com os componentes explicitamente informados no briefing."}</div>
          <div style={{ display: "flex", color: "#64748B", fontSize: 14, letterSpacing: 2, marginTop: "auto" }}>ARQUITETURA · DADOS · SOFTWARE ENGINEERING</div>
        </div>
      </div>,
      { width: 1080, height: 1350 },
    );
  }

  const vertical = format === "editorial-cover";
  const lines = titleLines(title);
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", position: "relative", background: "#0F172A", color: "#F8FAFC", fontFamily: "Arial" }}>
      {background ? <img src={background} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.25 }} /> : null}
      <div style={{ position: "absolute", inset: 0, display: "flex", background: "linear-gradient(180deg, rgba(15,23,42,.82) 0%, rgba(15,23,42,.72) 45%, rgba(15,23,42,.97) 100%)" }} />
      <div style={{ position: "absolute", left: 48, right: 48, top: 120, bottom: 140, display: "flex", borderRadius: 28, border: "2px solid rgba(125,211,252,.24)", background: "rgba(15,23,42,.56)" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "66px 72px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#7DD3FC", fontSize: 22, letterSpacing: 2 }}><span>{pillar}</span><span>ENGINEERING INSIGHT</span></div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 900, gap: 24, padding: "38px 40px" }}>
          <div style={{ display: "flex", color: "#F59E0B", fontSize: 21, letterSpacing: 3 }}>DECISÃO TÉCNICA</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: lines.length > 3 ? 43 : 58, lineHeight: 1.08, fontWeight: 700 }}>
            {lines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
          </div>
          <div style={{ display: "flex", width: 130, height: 7, borderRadius: 8, background: "#0EA5E9" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, color: "#CBD5E1", fontSize: 20 }}><span>LinkedIn · conteúdo técnico</span><span>feito para compartilhar</span></div>
      </div>
    </div>,
    { width: 1080, height: vertical ? 1350 : 1080 },
  );
}
