import { ImageResponse } from "@vercel/og";

export const runtime = "edge";

function clean(value: string | null, fallback: string, maxLength: number): string {
  const normalized = (value ?? fallback).replace(/[<>]/g, "").trim();
  return normalized.slice(0, maxLength) || fallback;
}

function isRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const thirtyTwo = 32;

function titleLines(value: string): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length >  thirtyTwo) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

export function GET(request: Request): ImageResponse {
  const params = new URL(request.url).searchParams;
  const background = params.get("background");
  const title = clean(params.get("title"), "Insight de engenharia", 160);
  const pillar = clean(params.get("pillar"), "TECH · DATA · GROWTH", 40).toUpperCase();
  const lines = titleLines(title);

  if (background && !isRemoteUrl(background)) {
    return new ImageResponse(<div />, { width: 1080, height: 1080, status: 400 });
  }

  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", position: "relative", background: "#0F172A", color: "#F8FAFC", fontFamily: "Arial" }}>
      {background ? <img src={background} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      <div style={{ position: "absolute", inset: 0, display: "flex", background: "linear-gradient(180deg, rgba(15,23,42,.12) 0%, rgba(15,23,42,.84) 68%, rgba(15,23,42,.98) 100%)" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "66px 72px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#7DD3FC", fontSize: 25, letterSpacing: 2 }}>
          <span>{pillar}</span><span>LINKEDIN INSIGHT</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 900, gap: 28 }}>
          <div style={{ display: "flex", color: "#F59E0B", fontSize: 24, letterSpacing: 3 }}>DECISÃO TÉCNICA</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 62, lineHeight: 1.08, fontWeight: 700 }}>
            {lines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
          </div>
          <div style={{ display: "flex", width: 130, height: 7, borderRadius: 8, background: "#0EA5E9" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#CBD5E1", fontSize: 22 }}>
          <span>Autonomous LinkedIn Content Engine</span><span>feito para compartilhar</span>
        </div>
      </div>
    </div>,
    { width: 1080, height: 1080 },
  );
}
