import { strict as assert } from "node:assert";
import { prisma } from "../src/lib/prisma.ts";
import { buildRagContext } from "../src/lib/rag.ts";

async function main(): Promise<void> {
  const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  assert.ok(editorialLine, "EditorialLine não encontrada.");

  const context = await buildRagContext(editorialLine.id);
  assert.match(context.systemPrompt, /base profissional publicável/u);
  assert.doesNotMatch(context.professionalKnowledge, /Restrição de publicação|RESTRICTED/u);
  assert.doesNotMatch(context.professionalKnowledge, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  console.log(JSON.stringify({
    ok: true,
    examples: context.examples.length,
    professionalKnowledgeCharacters: context.professionalKnowledge.length,
    hasProjects: /projetos de portfólio publicáveis/u.test(context.professionalKnowledge),
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("Teste do RAG profissional falhou:", error);
    process.exitCode = 1;
  })
  .finally(() => { void prisma.$disconnect(); });
