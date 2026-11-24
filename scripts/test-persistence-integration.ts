import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfirmedDevelopmentDatabase } from "./lib/confirmed-dev-database.ts";
import { assertEmptyApplicationTables } from "./lib/isolated-db-assertions.ts";

const rollbackMarker = "ROLLBACK_SYNTHETIC_PERSISTENCE_TEST";

async function main(): Promise<void> {
  const target = loadConfirmedDevelopmentDatabase();
  const { prisma } = await import("../src/lib/prisma.ts");
  const { PostStatus, QualityGateStatus } = await import("@prisma/client");
  const { getPublicationEligibility } = await import("../src/lib/publication-eligibility.ts");
  try {
    const seededCompanies = await prisma.monitoredCompany.findMany({ select: { companyKey: true }, orderBy: { companyKey: "asc" } });
    const seededTopics = await prisma.networkingTopic.findMany({ select: { key: true }, orderBy: { key: "asc" } });
    assert.deepEqual(seededCompanies.map(({ companyKey }) => companyKey), ["CODERIO"], "only the migration's deterministic monitored-company seed may exist");
    assert.deepEqual(seededTopics.map(({ key }) => key), [
      "architecture-system-design", "aws-cloud", "data-engineering", "distributed-systems", "etl-data-quality",
      "fastapi", "observability-reliability", "python", "spark-airflow", "sql-postgres", "technical-leadership",
    ], "only the migration's deterministic networking-topic seeds may exist");
    await assertEmptyApplicationTables(prisma, { allowPopulatedTables: ["MonitoredCompany", "NetworkingTopic"] });
    await prisma.$transaction(async (tx) => {
      const key = randomUUID();
      const source = await tx.knowledgeSource.create({ data: {
        sourceKey: `synthetic-test:${key}`, type: "USER_CONFIRMATION", title: "Synthetic integration fixture",
        contentHash: key, trustLevel: "VERIFIED", visibility: "INTERNAL_ONLY",
      } });
      const project = await tx.portfolioProject.create({ data: {
        projectKey: `synthetic-project:${key}`, name: "SyntheticProject", kind: "PORTFOLIO", summary: "Synthetic project for relational tests.",
        technologies: ["Python"], implementationStatus: "IMPLEMENTED", evidenceStatus: "VERIFIED", visibility: "PUBLIC_SAFE", publicAllowed: true,
        sources: { create: { sourceId: source.id } },
      } });
      const experience = await tx.professionalExperience.create({ data: {
        experienceKey: `synthetic-experience:${key}`, company: "SyntheticCo", title: "Backend Engineer", summary: "Synthetic Python backend experience.",
        technologies: ["Python"], evidenceStatus: "VERIFIED", visibility: "PUBLIC_SAFE", publicAllowed: true,
        sources: { create: { sourceId: source.id } },
      } });
      const fact = await tx.professionalFact.create({ data: {
        factKey: `synthetic-fact:${key}`, claim: "Synthetic public-safe claim.", category: "ARCHITECTURE", evidenceStatus: "USER_CONFIRMED",
        implementationStatus: "IMPLEMENTED", visibility: "PUBLIC_SAFE", publicAllowed: true,
      } });
      await tx.professionalFactSource.create({ data: { factId: fact.id, sourceId: source.id, excerpt: "Private source excerpt", excerptPublicAllowed: false } });
      const line = await tx.editorialLine.create({ data: {
        name: `Synthetic ${key}`, themes: ["backend"], toneOfVoice: "pragmatic", aidaRules: "clear", cvCases: "synthetic only",
        postsPerWeek: 2, languageDistribution: { "pt-BR": 1, "en-US": 1 },
      } });
      assert.deepEqual(line.languageDistribution, { "pt-BR": 1, "en-US": 1 });

      const post = await tx.post.create({ data: {
        editorialLineId: line.id, editorialPillar: "TOFU", funnelStage: "ATTENTION", formatType: "SINGLE_IMAGE",
        title: "Synthetic post", textContent: "Synthetic content", language: "pt-BR", status: PostStatus.AWAITING_APPROVAL,
        mediaUrl: "https://assets.example/creative-2.png", qualityStatus: QualityGateStatus.PASS, qualityScore: 90, scheduledFor: new Date(Date.now() + 86400000),
        qualityReview: { renderedImage: { status: "PASS", reviewedMediaUrl: "https://assets.example/creative-2.png" } },
      } });
      const version = await tx.postVersion.create({ data: { postId: post.id, versionNumber: 1, contentHash: key, title: post.title, textContent: post.textContent, reason: "synthetic" } });
      await tx.post.update({ where: { id: post.id }, data: { currentVersionId: version.id } });
      await tx.postProject.create({ data: { postId: post.id, projectId: project.id, role: "PRIMARY", confirmedBy: "synthetic-test" } });
      const firstCreative = await tx.creativeBrief.create({ data: {
        postId: post.id, postVersionId: version.id, creativeRevision: 1, version: 1, language: "pt-BR",
        thesis: "Synthetic thesis", technicalConflict: "Synthetic conflict", concreteProblem: "Synthetic problem", visualConcept: "Synthetic diagram", mediaUrl: "https://assets.example/creative-1.png", reviewStatus: QualityGateStatus.NEEDS_REVISION,
      } });
      const secondCreative = await tx.creativeBrief.create({ data: {
        postId: post.id, postVersionId: version.id, creativeRevision: 2, version: 2, language: "pt-BR",
        thesis: "Synthetic thesis", technicalConflict: "Synthetic conflict", concreteProblem: "Synthetic problem", visualConcept: "Improved synthetic diagram", mediaUrl: "https://assets.example/creative-2.png", reviewStatus: QualityGateStatus.PASS,
      } });
      assert.equal(firstCreative.postVersionId, secondCreative.postVersionId, "two creative revisions must share one text version");

      const asset = await tx.mediaAsset.create({ data: { origin: "CHATGPT_UPLOAD", storageProvider: "EXTERNAL", storageUrl: "https://assets.example/creative-2.png", sha256: key, contentType: "image/png", byteSize: BigInt(123) } });
      await tx.creativeBriefMedia.create({ data: { creativeBriefId: secondCreative.id, mediaAssetId: asset.id, role: "PRIMARY_IMAGE" } });
      await tx.creativeBriefEvidence.create({ data: {
        creativeBriefId: secondCreative.id, evidenceKey: "fact:synthetic", factId: fact.id, sourceId: source.id,
        claimSnapshot: "Synthetic public-safe claim.", sourceHash: source.contentHash, trustLevelSnapshot: source.trustLevel,
        visibilitySnapshot: "PUBLIC_SAFE", sourceVisibilitySnapshot: "INTERNAL_ONLY", implementationStatus: "IMPLEMENTED", publicAllowedSnapshot: true,
      } });
      await tx.creativeBriefEvidence.create({ data: {
        creativeBriefId: secondCreative.id, evidenceKey: "experience:synthetic", experienceId: experience.id, sourceId: source.id,
        claimSnapshot: "Synthetic backend experience.", sourceHash: source.contentHash, trustLevelSnapshot: source.trustLevel,
        visibilitySnapshot: "PUBLIC_SAFE", sourceVisibilitySnapshot: "INTERNAL_ONLY", implementationStatus: "IMPLEMENTED", publicAllowedSnapshot: true,
      } });
      await tx.creativeBriefEvidence.create({ data: {
        creativeBriefId: secondCreative.id, evidenceKey: "project:synthetic", projectId: project.id, sourceId: source.id,
        claimSnapshot: "Synthetic project evidence.", sourceHash: source.contentHash, trustLevelSnapshot: source.trustLevel,
        visibilitySnapshot: "PUBLIC_SAFE", sourceVisibilitySnapshot: "INTERNAL_ONLY", implementationStatus: "IMPLEMENTED", publicAllowedSnapshot: true,
      } });
      const evidenceLinks = await tx.creativeBriefEvidence.findMany({ where: { creativeBriefId: secondCreative.id }, select: { factId: true, experienceId: true, projectId: true, sourceVisibilitySnapshot: true, authorizedExcerpt: true } });
      assert.equal(evidenceLinks.length, 3, "a creative version must preserve fact, experience and project relations");
      assert.ok(evidenceLinks.every((link) => link.sourceVisibilitySnapshot === "INTERNAL_ONLY" && link.authorizedExcerpt === null), "authorized public claims may cite an internal source without copying its document excerpt");
      await tx.post.update({ where: { id: post.id }, data: { status: PostStatus.APPROVED, approvedCreativeBriefId: secondCreative.id } });
      await tx.postApprovalEvent.create({ data: { postId: post.id, postVersionId: version.id, creativeBriefId: secondCreative.id, eventType: "APPROVED", actor: "synthetic-test" } });
      const approved = await tx.post.findUnique({ where: { id: post.id }, include: { approvedCreativeBrief: { select: { id: true, postVersionId: true, reviewStatus: true, mediaUrl: true } } } });
      assert.ok(approved);
      assert.equal(getPublicationEligibility(approved).eligible, true, "approval must refer to the passing creative and exact current text version");

      await tx.postApprovalEvent.create({ data: { postId: post.id, postVersionId: version.id, creativeBriefId: secondCreative.id, eventType: "INVALIDATED", actor: "synthetic-test", reason: "media replacement" } });
      await tx.post.update({ where: { id: post.id }, data: { status: PostStatus.DRAFT, approvedCreativeBriefId: null, mediaUrl: "https://assets.example/replacement.png" } });
      const invalidated = await tx.post.findUnique({ where: { id: post.id } });
      assert.ok(invalidated);
      assert.equal(getPublicationEligibility(invalidated).eligible, false, "replacing media must invalidate the prior approval");
      throw new Error(rollbackMarker);
    }, { timeout: 15000 });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== rollbackMarker) throw error;
  } finally {
    await prisma.$disconnect();
  }
  console.log("Synthetic relational integration assertions passed and were rolled back.", { provider: target.provider, target: target.target });
}

main().catch((error: unknown) => { console.error("Persistence integration test failed:", error); process.exitCode = 1; });
