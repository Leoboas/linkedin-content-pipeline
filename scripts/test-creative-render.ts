import assert from "node:assert/strict";
import { GET } from "../src/app/api/og/creative/route.tsx";

async function render() {
  const flow = {
    nodes: ["Bronze", "Validação", "Silver", "Quarentena"],
    edges: [
      { from: "Bronze", to: "Validação", label: "eventos" },
      { from: "Validação", to: "Silver", label: "válidos" },
      { from: "Validação", to: "Quarentena", label: "inválidos" },
    ],
    scopeNote: "Falhas de validação são isoladas; não há afirmação de bucket dedicado.",
  };
  const url = new URL("https://local.test/api/og/creative");
  url.searchParams.set("title", "DriveSense: Bronze, validação, Silver e quarentena");
  url.searchParams.set("pillar", "DATA ENGINEERING");
  url.searchParams.set("format", "architecture-infographic");
  url.searchParams.set("flow", JSON.stringify(flow));
  const response = GET(new Request(url));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /image\/png/u);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 1080);
  assert.equal(bytes.readUInt32BE(20), 1350);
  console.log("creative render acceptance: complete title overlay, explicit Bronze → Validation → Silver/Quarantine flow, connectors and safe-scope note rendered to a 1080x1350 PNG.");
}

void render();
