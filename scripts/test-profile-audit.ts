import { readFileSync } from "node:fs";
import { auditLinkedInProfile } from "../src/lib/profile-auditor.ts";
import { prisma } from "../src/lib/prisma.ts";

function loadEnvFile(path: string): void {
  try {
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch { /* optional local env file */ }
}

async function main(): Promise<void> {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
  try {
    const report = await auditLinkedInProfile();
    console.log("\n=== AUDITORIA DO PERFIL LINKEDIN ===");
    console.log(`Nota geral: ${Math.round(report.score)}/100`);
    console.log(`Histórico de vagas analisadas: ${report.jobHistoryCount}`);
    console.log("\nHeadlines sugeridas:");
    for (const item of report.suggestedHeadlines) console.log(`- ${item}`);
    console.log("\nPalavras-chave de SEO:");
    console.log(report.seoKeywords.join(", ") || "Nenhuma palavra-chave identificada.");
    console.log("\nReescrita da seção Sobre:");
    console.log(report.aboutRewrite);
    console.log("\nForças identificadas:");
    for (const item of report.strengths) console.log(`- ${item}`);
    console.log("\nRecomendações:");
    for (const item of report.recommendations) console.log(`- ${item}`);
    console.log("\n=== FIM DA AUDITORIA ===\n");
  } catch (error) {
    console.error("AUDIT_TEST_FAILED:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
