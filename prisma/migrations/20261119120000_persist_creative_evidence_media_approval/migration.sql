BEGIN;

CREATE TYPE "PostProjectRole" AS ENUM ('PRIMARY', 'SECONDARY');
CREATE TYPE "MediaAssetOrigin" AS ENUM ('GENERATED_AI', 'CHATGPT_UPLOAD', 'DASHBOARD_UPLOAD', 'TELEGRAM_UPLOAD', 'STOCK', 'IMPORTED');
CREATE TYPE "MediaStorageProvider" AS ENUM ('VERCEL_BLOB', 'EXTERNAL');
CREATE TYPE "CreativeBriefMediaRole" AS ENUM ('PRIMARY_IMAGE', 'CAROUSEL_SLIDE', 'FINAL_PDF', 'SOURCE_REFERENCE');
CREATE TYPE "ApprovalAuditEventType" AS ENUM ('APPROVED', 'INVALIDATED', 'REJECTED');

ALTER TABLE "PostVersion"
  ADD COLUMN "versionNumber" INTEGER,
  ADD COLUMN "contentHash" TEXT;
CREATE UNIQUE INDEX "PostVersion_postId_versionNumber_key" ON "PostVersion"("postId", "versionNumber");

ALTER TABLE "CreativeBrief"
  ADD COLUMN "postVersionId" UUID,
  ADD COLUMN "creativeRevision" INTEGER,
  ADD COLUMN "language" TEXT,
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "mediaHash" TEXT,
  ADD COLUMN "contentBrief" JSONB,
  ADD COLUMN "visualBrief" JSONB;
CREATE UNIQUE INDEX "CreativeBrief_postVersionId_creativeRevision_key" ON "CreativeBrief"("postVersionId", "creativeRevision");
CREATE INDEX "CreativeBrief_postVersionId_createdAt_idx" ON "CreativeBrief"("postVersionId", "createdAt");
ALTER TABLE "CreativeBrief" ADD CONSTRAINT "CreativeBrief_postVersionId_fkey"
  FOREIGN KEY ("postVersionId") REFERENCES "PostVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Post"
  ADD COLUMN "currentVersionId" UUID,
  ADD COLUMN "approvedCreativeBriefId" UUID;
ALTER TABLE "Post" ADD CONSTRAINT "Post_currentVersionId_fkey"
  FOREIGN KEY ("currentVersionId") REFERENCES "PostVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_approvedCreativeBriefId_fkey"
  FOREIGN KEY ("approvedCreativeBriefId") REFERENCES "CreativeBrief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PostProject" (
  "id" UUID NOT NULL,
  "postId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "role" "PostProjectRole" NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedBy" TEXT,
  "auditNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostProject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PostProject_postId_projectId_key" ON "PostProject"("postId", "projectId");
CREATE UNIQUE INDEX "PostProject_one_primary_per_post_key" ON "PostProject"("postId") WHERE "role" = 'PRIMARY';
CREATE INDEX "PostProject_projectId_role_idx" ON "PostProject"("projectId", "role");
ALTER TABLE "PostProject" ADD CONSTRAINT "PostProject_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostProject" ADD CONSTRAINT "PostProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PortfolioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MediaAsset" (
  "id" UUID NOT NULL,
  "origin" "MediaAssetOrigin" NOT NULL,
  "storageProvider" "MediaStorageProvider" NOT NULL,
  "storageKey" TEXT,
  "storageUrl" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "byteSize" BIGINT,
  "width" INTEGER,
  "height" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");
CREATE INDEX "MediaAsset_sha256_idx" ON "MediaAsset"("sha256");
CREATE INDEX "MediaAsset_origin_createdAt_idx" ON "MediaAsset"("origin", "createdAt");

CREATE TABLE "CreativeBriefMedia" (
  "id" UUID NOT NULL,
  "creativeBriefId" UUID NOT NULL,
  "mediaAssetId" UUID NOT NULL,
  "role" "CreativeBriefMediaRole" NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreativeBriefMedia_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreativeBriefMedia_brief_role_position_key" ON "CreativeBriefMedia"("creativeBriefId", "role", "position");
CREATE INDEX "CreativeBriefMedia_mediaAssetId_idx" ON "CreativeBriefMedia"("mediaAssetId");
ALTER TABLE "CreativeBriefMedia" ADD CONSTRAINT "CreativeBriefMedia_creativeBriefId_fkey" FOREIGN KEY ("creativeBriefId") REFERENCES "CreativeBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreativeBriefMedia" ADD CONSTRAINT "CreativeBriefMedia_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProfessionalFactSource" ADD COLUMN "excerptPublicAllowed" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE "CreativeBriefEvidence" (
  "id" UUID NOT NULL,
  "creativeBriefId" UUID NOT NULL,
  "evidenceKey" TEXT NOT NULL,
  "factId" UUID,
  "experienceId" UUID,
  "projectId" UUID,
  "sourceId" UUID NOT NULL,
  "knowledgeDocumentId" UUID,
  "claimSnapshot" TEXT NOT NULL,
  "authorizedExcerpt" TEXT,
  "sourceHash" TEXT NOT NULL,
  "trustLevelSnapshot" "KnowledgeTrustLevel" NOT NULL,
  "visibilitySnapshot" "KnowledgeVisibility" NOT NULL,
  "sourceVisibilitySnapshot" "KnowledgeVisibility" NOT NULL,
  "implementationStatus" "ImplementationStatus" NOT NULL,
  "publicAllowedSnapshot" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreativeBriefEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreativeBriefEvidence_one_subject_check" CHECK (num_nonnulls("factId", "experienceId", "projectId") = 1),
  CONSTRAINT "CreativeBriefEvidence_excerpt_authorized_check" CHECK ("authorizedExcerpt" IS NULL OR "publicAllowedSnapshot" = TRUE)
);
CREATE UNIQUE INDEX "CreativeBriefEvidence_brief_evidenceKey_key" ON "CreativeBriefEvidence"("creativeBriefId", "evidenceKey");
CREATE INDEX "CreativeBriefEvidence_factId_idx" ON "CreativeBriefEvidence"("factId");
CREATE INDEX "CreativeBriefEvidence_experienceId_idx" ON "CreativeBriefEvidence"("experienceId");
CREATE INDEX "CreativeBriefEvidence_projectId_idx" ON "CreativeBriefEvidence"("projectId");
CREATE INDEX "CreativeBriefEvidence_sourceId_idx" ON "CreativeBriefEvidence"("sourceId");
ALTER TABLE "CreativeBriefEvidence" ADD CONSTRAINT "CreativeBriefEvidence_brief_fkey" FOREIGN KEY ("creativeBriefId") REFERENCES "CreativeBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreativeBriefEvidence" ADD CONSTRAINT "CreativeBriefEvidence_fact_fkey" FOREIGN KEY ("factId") REFERENCES "ProfessionalFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreativeBriefEvidence" ADD CONSTRAINT "CreativeBriefEvidence_experience_fkey" FOREIGN KEY ("experienceId") REFERENCES "ProfessionalExperience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreativeBriefEvidence" ADD CONSTRAINT "CreativeBriefEvidence_project_fkey" FOREIGN KEY ("projectId") REFERENCES "PortfolioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreativeBriefEvidence" ADD CONSTRAINT "CreativeBriefEvidence_source_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreativeBriefEvidence" ADD CONSTRAINT "CreativeBriefEvidence_document_fkey" FOREIGN KEY ("knowledgeDocumentId") REFERENCES "KnowledgeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PostApprovalEvent" (
  "id" UUID NOT NULL,
  "postId" UUID NOT NULL,
  "postVersionId" UUID NOT NULL,
  "creativeBriefId" UUID NOT NULL,
  "eventType" "ApprovalAuditEventType" NOT NULL,
  "actor" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostApprovalEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PostApprovalEvent_postId_createdAt_idx" ON "PostApprovalEvent"("postId", "createdAt");
CREATE INDEX "PostApprovalEvent_version_brief_idx" ON "PostApprovalEvent"("postVersionId", "creativeBriefId");
ALTER TABLE "PostApprovalEvent" ADD CONSTRAINT "PostApprovalEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostApprovalEvent" ADD CONSTRAINT "PostApprovalEvent_postVersionId_fkey" FOREIGN KEY ("postVersionId") REFERENCES "PostVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostApprovalEvent" ADD CONSTRAINT "PostApprovalEvent_creativeBriefId_fkey" FOREIGN KEY ("creativeBriefId") REFERENCES "CreativeBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
