import { strict as assert } from "node:assert";
import { loadConfirmedDevelopmentDatabase } from "./lib/confirmed-dev-database.ts";

const directory = process.argv[2] ?? process.env.KNOWLEDGE_CONTEXT_DIR ?? "context/LinkedIn_Career_Automation_Context";

async function main(): Promise<void> {
  loadConfirmedDevelopmentDatabase();
  const [{ importProfessionalKnowledge }, { prisma }] = await Promise.all([
    import("../src/lib/knowledge-base/importer.ts"),
    import("../src/lib/prisma.ts"),
  ]);
  try {
  const postsBefore = await prisma.post.count();
  const first = await importProfessionalKnowledge(directory);
  const postsAfterFirst = await prisma.post.count();
  const second = await importProfessionalKnowledge(directory);
  const postsAfterSecond = await prisma.post.count();

  assert.equal(postsAfterFirst, postsBefore, "A importação não pode criar posts.");
  assert.equal(postsAfterSecond, postsBefore, "A reimportação não pode criar posts.");
  assert.equal(second.status, "SKIPPED", "A segunda importação idêntica deve ser ignorada.");
  assert.ok(first.filesProcessed > 0, "A primeira importação deve processar arquivos.");
  assert.ok(first.recordsCreated > 0 || first.recordsUpdated > 0 || first.recordsSkipped > 0, "A importação deve registrar algum resultado.");
  console.log(JSON.stringify({ ok: true, postsBefore, postsAfterFirst, postsAfterSecond, first, second }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error: unknown) => {
    console.error("Teste da base de conhecimento falhou:", error);
    process.exitCode = 1;
  });
