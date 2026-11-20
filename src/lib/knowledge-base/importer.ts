import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { KnowledgeEvidenceStatus, KnowledgeImportStatus, KnowledgeSourceType, KnowledgeTrustLevel, KnowledgeVisibility, ImplementationStatus, PortfolioProjectKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface ImportSummary {
  importKey: string;
  contentHash: string;
  status: KnowledgeImportStatus;
  filesProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
}

type ProfileJson = {
  person?: { professional_name?: string; location?: string; github?: string; linkedin?: string };
  goals?: { primary?: string[]; secondary?: string[]; positioning?: string };
  experience?: Array<{ company?: string; title?: string; start?: string; end?: string | null; focus?: string[]; notes?: string[] }>;
  portfolio?: Array<{ name?: string; kind?: string; source?: string; stack?: string[]; themes?: string[]; limitations?: string[]; status?: string }>;
  editorial?: { confidentiality?: string[] };
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sourceType(filename: string): KnowledgeSourceType {
  if (/perfil_profissional\.json$/i.test(filename)) return KnowledgeSourceType.USER_CONFIRMATION;
  if (/ideias_de_posts\.csv$/i.test(filename)) return KnowledgeSourceType.EDITORIAL_PLAN;
  if (/curr|resume|cv/i.test(filename)) return KnowledgeSourceType.RESUME;
  if (/repos|github/i.test(filename)) return KnowledgeSourceType.REPOSITORY;
  return /03_|05_|02_/.test(filename) ? KnowledgeSourceType.EDITORIAL_PLAN : KnowledgeSourceType.DOCUMENT;
}

function trustLevel(filename: string): KnowledgeTrustLevel {
  if (/perfil_profissional\.json|01_PERFIL|00_LEIA/i.test(filename)) return KnowledgeTrustLevel.HIGH;
  if (/curr|resume|cv|github|repo/i.test(filename)) return KnowledgeTrustLevel.VERIFIED;
  return KnowledgeTrustLevel.MEDIUM;
}

function evidenceStatus(filename: string): KnowledgeEvidenceStatus {
  if (/perfil_profissional\.json|01_PERFIL|00_LEIA/i.test(filename)) return KnowledgeEvidenceStatus.USER_CONFIRMED;
  if (/curr|resume|cv|github|repo/i.test(filename)) return KnowledgeEvidenceStatus.VERIFIED;
  return KnowledgeEvidenceStatus.DOCUMENTED;
}

function parseMonth(value?: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return (value ?? []) as Prisma.InputJsonValue;
}

function projectKind(value?: string): PortfolioProjectKind {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("synthetic")) return PortfolioProjectKind.SYNTHETIC_DEMO;
  if (normalized.includes("academic")) return PortfolioProjectKind.ACADEMIC;
  if (normalized.includes("open")) return PortfolioProjectKind.OPEN_SOURCE;
  if (normalized.includes("planned")) return PortfolioProjectKind.PLANNED;
  return PortfolioProjectKind.PORTFOLIO;
}

function projectImplementationStatus(value?: string): ImplementationStatus {
  if (/code and docs exist|implemented|exist/i.test(value ?? "")) return ImplementationStatus.IMPLEMENTED;
  if (/planned/i.test(value ?? "")) return ImplementationStatus.PLANNED;
  return ImplementationStatus.USED_IN_PORTFOLIO;
}

async function readContextFiles(directory: string): Promise<Array<{ filename: string; content: string; hash: string }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && /\.(md|txt|json|csv)$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(files.map(async (entry) => {
    const content = await readFile(join(directory, entry.name), "utf8");
    return { filename: entry.name, content, hash: sha256(content) };
  }));
}

export async function importProfessionalKnowledge(directoryInput: string): Promise<ImportSummary> {
  const directory = resolve(directoryInput);
  const files = await readContextFiles(directory);
  if (files.length === 0) throw new Error(`Nenhum arquivo de conhecimento encontrado em ${directory}.`);
  const contentHash = sha256(files.map((file) => `${file.filename}:${file.hash}`).join("\n"));
  const importKey = `professional-context:${directory}`;
  const previous = await prisma.knowledgeImportRun.findUnique({ where: { importKey_contentHash: { importKey, contentHash } } });
  if (previous?.status === KnowledgeImportStatus.COMPLETED) {
    return { importKey, contentHash, status: KnowledgeImportStatus.SKIPPED, filesProcessed: previous.filesProcessed, recordsCreated: 0, recordsUpdated: 0, recordsSkipped: previous.filesProcessed };
  }

  const run = await prisma.knowledgeImportRun.upsert({
    where: { importKey_contentHash: { importKey, contentHash } },
    create: { importKey, contentHash, status: KnowledgeImportStatus.RUNNING },
    update: { status: KnowledgeImportStatus.RUNNING, errorMessage: null, completedAt: null },
  });
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;
  try {
    const sources = new Map<string, { id: string; filename: string }>();
    for (const file of files) {
      const existing = await prisma.knowledgeSource.findUnique({ where: { sourceKey: `file:${file.filename}` } });
      const source = await prisma.knowledgeSource.upsert({
        where: { sourceKey: `file:${file.filename}` },
        create: { sourceKey: `file:${file.filename}`, type: sourceType(file.filename), title: file.filename, contentHash: file.hash, trustLevel: trustLevel(file.filename), visibility: KnowledgeVisibility.INTERNAL_ONLY },
        update: { contentHash: file.hash, type: sourceType(file.filename), trustLevel: trustLevel(file.filename), updatedAt: new Date() },
      });
      sources.set(file.filename, { id: source.id, filename: file.filename });
      if (existing) recordsUpdated += 1; else recordsCreated += 1;
      const documentExisting = await prisma.knowledgeDocument.findFirst({ where: { sourceId: source.id, contentHash: file.hash } });
      if (documentExisting) recordsSkipped += 1;
      else {
        await prisma.knowledgeDocument.create({ data: { sourceId: source.id, filename: file.filename, mimeType: file.filename.endsWith(".json") ? "application/json" : file.filename.endsWith(".csv") ? "text/csv" : "text/markdown", content: file.content, contentHash: file.hash } });
        recordsCreated += 1;
      }
    }

    const profileFile = files.find((file) => file.filename === "perfil_profissional.json");
    if (profileFile) {
      const profile = JSON.parse(profileFile.content) as ProfileJson;
      const profileSource = sources.get(profileFile.filename);
      if (!profileSource) throw new Error("Fonte do perfil profissional não registrada.");
      const upsertFact = async (factKey: string, claim: string, category: "SKILL" | "POSITIONING" | "CAREER", status: KnowledgeEvidenceStatus = KnowledgeEvidenceStatus.USER_CONFIRMED, implementation: ImplementationStatus = ImplementationStatus.GENERAL_KNOWLEDGE, publicAllowed = true): Promise<void> => {
        const existing = await prisma.professionalFact.findUnique({ where: { factKey } });
        const fact = await prisma.professionalFact.upsert({
          where: { factKey },
          create: { factKey, claim, category, evidenceStatus: status, implementationStatus: implementation, visibility: publicAllowed ? KnowledgeVisibility.PUBLIC_SAFE : KnowledgeVisibility.INTERNAL_ONLY, publicAllowed },
          update: { claim, category, evidenceStatus: status, implementationStatus: implementation, publicAllowed, visibility: publicAllowed ? KnowledgeVisibility.PUBLIC_SAFE : KnowledgeVisibility.INTERNAL_ONLY },
        });
        await prisma.professionalFactSource.upsert({ where: { factId_sourceId: { factId: fact.id, sourceId: profileSource.id } }, create: { factId: fact.id, sourceId: profileSource.id, excerpt: claim, verifiedAt: new Date() }, update: { excerpt: claim, verifiedAt: new Date() } });
        if (existing) recordsUpdated += 1; else recordsCreated += 1;
      };

      for (const goal of [...(profile.goals?.primary ?? []), ...(profile.goals?.secondary ?? [])]) await upsertFact(`fact:target-role:${goal.toLowerCase()}`, `Cargo-alvo: ${goal}`, "POSITIONING");
      if (profile.goals?.positioning) await upsertFact("fact:positioning:primary", profile.goals.positioning, "POSITIONING");

      for (const experience of profile.experience ?? []) {
        if (!experience.company || !experience.title) continue;
        const experienceKey = `experience:${experience.company.toLowerCase()}:${experience.start ?? "unknown"}`;
        const existing = await prisma.professionalExperience.findUnique({ where: { experienceKey } });
        const record = await prisma.professionalExperience.upsert({
          where: { experienceKey },
          create: { experienceKey, company: experience.company, title: experience.title, startDate: parseMonth(experience.start), endDate: parseMonth(experience.end), current: !experience.end, summary: [...(experience.focus ?? []), ...(experience.notes ?? [])].join("; ") || experience.title, technologies: jsonValue(experience.focus ?? []), evidenceStatus: evidenceStatus(profileFile.filename), visibility: KnowledgeVisibility.PUBLIC_SAFE, publicAllowed: true, confidentialityNote: (experience.notes ?? []).join("; ") || null },
          update: { company: experience.company, title: experience.title, startDate: parseMonth(experience.start), endDate: parseMonth(experience.end), current: !experience.end, summary: [...(experience.focus ?? []), ...(experience.notes ?? [])].join("; ") || experience.title, technologies: jsonValue(experience.focus ?? []), evidenceStatus: evidenceStatus(profileFile.filename), publicAllowed: true, confidentialityNote: (experience.notes ?? []).join("; ") || null },
        });
        await prisma.experienceSource.upsert({ where: { experienceId_sourceId: { experienceId: record.id, sourceId: profileSource.id } }, create: { experienceId: record.id, sourceId: profileSource.id }, update: {} });
        if (existing) recordsUpdated += 1; else recordsCreated += 1;
      }

      for (const project of profile.portfolio ?? []) {
        if (!project.name) continue;
        const projectKey = `project:${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const isDriveSense = /drivesense/i.test(project.name);
        const publicAllowed = isDriveSense;
        const existing = await prisma.portfolioProject.findUnique({ where: { projectKey } });
        const record = await prisma.portfolioProject.upsert({
          where: { projectKey },
          create: { projectKey, name: project.name, kind: projectKind(project.kind), publicUrl: project.source?.startsWith("http") ? project.source : null, summary: project.status ?? project.name, technologies: jsonValue(project.stack ?? []), themes: jsonValue(project.themes ?? []), limitations: jsonValue(project.limitations ?? []), implementationStatus: projectImplementationStatus(project.status), evidenceStatus: isDriveSense ? KnowledgeEvidenceStatus.DOCUMENTED : KnowledgeEvidenceStatus.NEEDS_REVIEW, visibility: publicAllowed ? KnowledgeVisibility.PUBLIC_SAFE : KnowledgeVisibility.INTERNAL_ONLY, publicAllowed, confidentialityNote: publicAllowed ? null : "Link ou evidência pública do projeto ainda precisa ser confirmado." },
          update: { name: project.name, kind: projectKind(project.kind), publicUrl: project.source?.startsWith("http") ? project.source : null, summary: project.status ?? project.name, technologies: jsonValue(project.stack ?? []), themes: jsonValue(project.themes ?? []), limitations: jsonValue(project.limitations ?? []), implementationStatus: projectImplementationStatus(project.status), evidenceStatus: isDriveSense ? KnowledgeEvidenceStatus.DOCUMENTED : KnowledgeEvidenceStatus.NEEDS_REVIEW, visibility: publicAllowed ? KnowledgeVisibility.PUBLIC_SAFE : KnowledgeVisibility.INTERNAL_ONLY, publicAllowed, confidentialityNote: publicAllowed ? null : "Link ou evidência pública do projeto ainda precisa ser confirmado." },
        });
        await prisma.projectSource.upsert({ where: { projectId_sourceId: { projectId: record.id, sourceId: profileSource.id } }, create: { projectId: record.id, sourceId: profileSource.id }, update: {} });
        if (existing) recordsUpdated += 1; else recordsCreated += 1;
      }

      for (const [index, rule] of (profile.editorial?.confidentiality ?? []).entries()) await upsertFact(`policy:confidentiality:${index}`, `Restrição de publicação: ${rule}`, "CAREER", KnowledgeEvidenceStatus.RESTRICTED, ImplementationStatus.UNKNOWN, false);
    }

    const result = await prisma.knowledgeImportRun.update({ where: { id: run.id }, data: { status: KnowledgeImportStatus.COMPLETED, filesProcessed: files.length, recordsCreated, recordsUpdated, recordsSkipped, completedAt: new Date() } });
    return { importKey, contentHash, status: result.status, filesProcessed: result.filesProcessed, recordsCreated, recordsUpdated, recordsSkipped };
  } catch (error) {
    await prisma.knowledgeImportRun.update({ where: { id: run.id }, data: { status: KnowledgeImportStatus.FAILED, filesProcessed: files.length, recordsCreated, recordsUpdated, recordsSkipped, errorMessage: error instanceof Error ? error.message : String(error), completedAt: new Date() } });
    throw error;
  }
}

export async function getKnowledgeSummary() {
  const [sources, documents, facts, experiences, projects, imports] = await Promise.all([
    prisma.knowledgeSource.findMany({ orderBy: { title: "asc" }, select: { id: true, sourceKey: true, type: true, title: true, trustLevel: true, visibility: true, contentHash: true, updatedAt: true } }),
    prisma.knowledgeDocument.count(),
    prisma.professionalFact.findMany({ orderBy: { factKey: "asc" }, select: { id: true, factKey: true, claim: true, category: true, evidenceStatus: true, implementationStatus: true, visibility: true, publicAllowed: true } }),
    prisma.professionalExperience.findMany({ orderBy: { startDate: "asc" }, select: { id: true, experienceKey: true, company: true, title: true, evidenceStatus: true, visibility: true, publicAllowed: true } }),
    prisma.portfolioProject.findMany({ orderBy: { name: "asc" }, select: { id: true, projectKey: true, name: true, kind: true, evidenceStatus: true, implementationStatus: true, visibility: true, publicAllowed: true } }),
    prisma.knowledgeImportRun.findMany({ orderBy: { startedAt: "desc" }, take: 10, select: { importKey: true, contentHash: true, status: true, filesProcessed: true, recordsCreated: true, recordsUpdated: true, recordsSkipped: true, errorMessage: true, startedAt: true, completedAt: true } }),
  ]);
  return { sources, documents, facts, experiences, projects, imports };
}
