import { strict as assert } from "node:assert";
import { prisma } from "../src/lib/prisma.ts";
import { validateContentClaims } from "../src/lib/claim-validator.ts";

async function main(): Promise<void> {
  const line = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  assert.ok(line, "EditorialLine não encontrada.");
  const unsupported = await validateContentClaims({ title: "Resultado: +9999% de crescimento", textContent: "A plataforma multiplicou o resultado em R$ 999 milhões.", editorialLineId: line.id });
  assert.equal(unsupported.blocked, true, "Métrica sem evidência deve bloquear o conteúdo.");
  const neutral = await validateContentClaims({ title: "Como escolher um contrato de dados", textContent: "Uma decisão de arquitetura começa com uma pergunta sobre qualidade e operação.", editorialLineId: line.id });
  assert.equal(neutral.blocked, false, "Conteúdo sem afirmação quantitativa não deve ser bloqueado.");
  console.log(JSON.stringify({ ok: true, unsupportedScore: unsupported.score, neutralScore: neutral.score }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("Teste do validador de afirmações falhou:", error);
    process.exitCode = 1;
  })
  .finally(() => { void prisma.$disconnect(); });
