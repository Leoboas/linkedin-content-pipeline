import { loadConfirmedDevelopmentDatabase } from "./lib/confirmed-dev-database.ts";

try {
  const target = loadConfirmedDevelopmentDatabase();
  console.log("Alvo isolado confirmado (nenhuma conexão ou escrita realizada):", target);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
