import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import { loadConfirmedDevelopmentDatabase } from "./lib/confirmed-dev-database.ts";
import { suggestProjectMatches } from "../src/lib/project-reconciliation.ts";

async function main(): Promise<void> {
  const target = loadConfirmedDevelopmentDatabase();
  const posts = await prisma.post.findMany({ where: { associatedProject: { not: null } }, select: { id: true, associatedProject: true } });
  const projects = await prisma.portfolioProject.findMany({ select: { id: true, projectKey: true, name: true } });
  const suggestions = suggestProjectMatches({ posts, projects });
  const mappingPath = resolve(process.cwd(), process.env.PROJECT_RECONCILIATION_FILE ?? "data/project-reconciliation-confirmed.json");
  let confirmed: Array<{ postId: string; projectKey: string; role: "PRIMARY" | "SECONDARY" }> = [];
  try { confirmed = JSON.parse(await readFile(mappingPath, "utf8")) as typeof confirmed; } catch { /* dry-run does not require a confirmation file */ }
  const apply = process.argv.includes("--apply-confirmed");
  const report = { mode: apply ? "apply-confirmed" : "dry-run", target: { projectId: target.projectId, branchId: target.branchId, fingerprint: target.fingerprint }, scanned: posts.length, suggestions, confirmedMappings: confirmed.length };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) return;
  if (confirmed.length === 0) throw new Error("Nenhum mapeamento humano confirmado encontrado; nenhum registro alterado.");
  await prisma.$transaction(async (tx) => {
    for (const entry of confirmed) {
      const post = await tx.post.findUnique({ where: { id: entry.postId }, select: { id: true, associatedProject: true } });
      const project = await tx.portfolioProject.findUnique({ where: { projectKey: entry.projectKey }, select: { id: true } });
      if (!post || !project || !post.associatedProject) throw new Error(`Mapeamento inválido para post ${entry.postId}; transação cancelada.`);
      await tx.postProject.upsert({
        where: { postId_projectId: { postId: post.id, projectId: project.id } },
        create: { postId: post.id, projectId: project.id, role: entry.role, confirmedBy: "human-confirmed-mapping-file", auditNote: `Legacy label: ${post.associatedProject}` },
        update: { role: entry.role, confirmedAt: new Date(), confirmedBy: "human-confirmed-mapping-file", auditNote: `Legacy label: ${post.associatedProject}` },
      });
    }
  });
}

main().catch((error: unknown) => { console.error("Falha na reconciliação de projetos:", error); process.exitCode = 1; }).finally(() => { void prisma.$disconnect(); });
