import { strict as assert } from "node:assert";
import { prisma } from "../src/lib/prisma.ts";
import { buildEditorialPlan, isRecentTitleTooSimilar } from "../src/lib/editorial-planner.ts";

async function main(): Promise<void> {
  const line = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  assert.ok(line, "EditorialLine não encontrada.");
  const plan = await buildEditorialPlan(line.id);
  assert.match(plan.systemPrompt, /REGRAS DE DIVERSIFICAÇÃO/u);
  assert.ok(isRecentTitleTooSimilar(plan.recentTitles[0] ?? "", plan.recentTitles), "O detector deve reconhecer um título já existente.");
  console.log(JSON.stringify({ ok: true, language: plan.language, recentTitles: plan.recentTitles.length }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("Teste do planejamento editorial falhou:", error);
    process.exitCode = 1;
  })
  .finally(() => { void prisma.$disconnect(); });
