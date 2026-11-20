import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { KnowledgeEvidenceStatus, KnowledgeVisibility, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface ClaimValidation {
  blocked: boolean;
  score: number;
  unsupportedClaims: string[];
  supportedClaims: string[];
  evidenceSources: string[];
}

const technicalTerms = [
  "Python", "TypeScript", "Node.js", "FastAPI", "PostgreSQL", "SQLite", "Redis",
  "PySpark", "Apache Spark", "Apache Airflow", "AWS", "Amazon S3", "AWS S3",
  "AWS Glue", "Athena", "Docker", "Terraform", "Celery", "Streamlit",
  "machine learning", "ML", "Isolation Forest", "ETL", "ELT", "multi-tenant",
  "idempotência", "idempotency", "quarentena", "observabilidade", "schema versioning",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^()|[\]\\]/gu, "\\$&");
}

function technicalClaims(text: string): string[] {
  return technicalTerms.filter((term) => new RegExp("\\b" + escapeRegExp(term) + "\\b", "iu").test(text));
}

function sentences(value: string): string[] {
  return value.replace(/\r/gu, "").split(/(?<=[.!?])\s+|\n+/u).map((item) => item.trim()).filter(Boolean);
}

function numericTokens(value: string): string[] {
  return [...value.matchAll(/(?:R\$|US\$|€|£)?\s*\+?\d+(?:[.,]\d+)?\s*(?:%|mil|milhão|milhões|mi|k|x)?/giu)]
    .map((match) => match[0].toLowerCase().replace(/\s+/gu, "").replace(/,/gu, "."))
    .filter((token) => !/^\+?(?:19|20)\d{2}$/u.test(token));
}

function claimSentences(text: string): string[] {
  return sentences(text).filter((sentence) => numericTokens(sentence).length > 0);
}

function hasEvidence(claim: string, evidence: string): boolean {
  const tokens = numericTokens(claim);
  const normalizedEvidence = evidence.toLowerCase().replace(/,/gu, ".").replace(/\s+/gu, "");
  return tokens.length > 0 && tokens.every((token) => normalizedEvidence.includes(token));
}

async function loadEvidence(editorialLineId?: string): Promise<{ text: string; sources: string[] }> {
  const [facts, experiences, projects, line, dossier] = await Promise.all([
    prisma.professionalFact.findMany({
      where: { publicAllowed: true, visibility: KnowledgeVisibility.PUBLIC_SAFE, evidenceStatus: { in: [KnowledgeEvidenceStatus.VERIFIED, KnowledgeEvidenceStatus.DOCUMENTED, KnowledgeEvidenceStatus.USER_CONFIRMED] } },
      select: { claim: true },
    }),
    prisma.professionalExperience.findMany({
      where: { publicAllowed: true, visibility: KnowledgeVisibility.PUBLIC_SAFE, evidenceStatus: { in: [KnowledgeEvidenceStatus.VERIFIED, KnowledgeEvidenceStatus.DOCUMENTED, KnowledgeEvidenceStatus.USER_CONFIRMED] } },
      select: { company: true, title: true, summary: true },
    }),
    prisma.portfolioProject.findMany({
      where: { publicAllowed: true, visibility: KnowledgeVisibility.PUBLIC_SAFE, evidenceStatus: { in: [KnowledgeEvidenceStatus.VERIFIED, KnowledgeEvidenceStatus.DOCUMENTED, KnowledgeEvidenceStatus.USER_CONFIRMED] } },
      select: { name: true, summary: true },
    }),
    editorialLineId ? prisma.editorialLine.findUnique({ where: { id: editorialLineId }, select: { cvCases: true } }) : null,
    readFile(join(process.cwd(), "data", "brand-dossier.md"), "utf8").catch(() => ""),
  ]);

  return {
    text: [
      facts.map((fact) => fact.claim).join("\n"),
      experiences.map((experience) => `${experience.title} ${experience.company} ${experience.summary}`).join("\n"),
      projects.map((project) => `${project.name} ${project.summary}`).join("\n"),
      line?.cvCases ?? "",
      dossier,
    ].join("\n"),
    sources: [
      facts.length > 0 ? "ProfessionalFact" : "",
      experiences.length > 0 ? "ProfessionalExperience" : "",
      projects.length > 0 ? "PortfolioProject" : "",
      line ? "EditorialLine.cvCases" : "",
      dossier ? "data/brand-dossier.md" : "",
    ].filter(Boolean),
  };
}

export async function validateContentClaims(input: { title: string; textContent: string; editorialLineId?: string }): Promise<ClaimValidation> {
  const fullText = input.title + "\n" + input.textContent;
  const claims = claimSentences(fullText);

  const evidence = await loadEvidence(input.editorialLineId);
  const supportedClaims = claims.filter((claim) => hasEvidence(claim, evidence.text));
  const unsupportedClaims = claims.filter((claim) => !hasEvidence(claim, evidence.text));
  const unsupportedTechnicalClaims = technicalClaims(fullText).filter((term) => !new RegExp("\\b" + escapeRegExp(term) + "\\b", "iu").test(evidence.text));
  const allUnsupported = [...unsupportedClaims, ...unsupportedTechnicalClaims.map((term) => "tecnologia/capacidade sem evidência: " + term)];
  if (claims.length === 0 && unsupportedTechnicalClaims.length === 0) return { blocked: false, score: 100, unsupportedClaims: [], supportedClaims: [], evidenceSources: [] };
  return {
    blocked: allUnsupported.length > 0,
    score: claims.length === 0 ? 0 : Math.round((supportedClaims.length / claims.length) * 100),
    unsupportedClaims: allUnsupported.slice(0, 8),
    supportedClaims: supportedClaims.slice(0, 8),
    evidenceSources: evidence.sources,
  };
}

export function claimsReviewJson(review: ClaimValidation): Prisma.InputJsonValue {
  return review as unknown as Prisma.InputJsonValue;
}
