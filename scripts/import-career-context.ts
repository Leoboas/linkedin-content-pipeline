import { loadConfirmedDevelopmentDatabase } from "./lib/confirmed-dev-database.ts";

const directory = process.argv[2] ?? process.env.KNOWLEDGE_CONTEXT_DIR ?? "context/LinkedIn_Career_Automation_Context";

async function main(): Promise<void> {
  loadConfirmedDevelopmentDatabase();
  const { importProfessionalKnowledge } = await import("../src/lib/knowledge-base/importer.ts");
  const result = await importProfessionalKnowledge(directory);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
    console.error("Falha ao importar base profissional:", error);
    process.exitCode = 1;
  });
