-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FunnelStage" AS ENUM ('ATTENTION', 'INTEREST', 'DESIRE', 'ACTION');

-- CreateEnum
CREATE TYPE "EditorialPillar" AS ENUM ('TOFU', 'MOFU', 'BOFU');

-- CreateEnum
CREATE TYPE "FormatType" AS ENUM ('CAROUSEL_PDF', 'SINGLE_IMAGE', 'TEXT_ONLY');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PENDING', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'REJECTED', 'REJECTED_PENDING_FEEDBACK', 'REGENERATING', 'PUBLISHING', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JobListingStatus" AS ENUM ('OPEN', 'CLOSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('LINKEDIN', 'AUTHORIZED_FEED', 'MANUAL');

-- CreateEnum
CREATE TYPE "SearchRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResumeDraftStatus" AS ENUM ('DRAFT', 'AWAITING_REVIEW', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('RESUME', 'REPOSITORY', 'DOCUMENT', 'USER_CONFIRMATION', 'EDITORIAL_PLAN', 'CONVERSATION');

-- CreateEnum
CREATE TYPE "KnowledgeTrustLevel" AS ENUM ('VERIFIED', 'HIGH', 'MEDIUM', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "KnowledgeVisibility" AS ENUM ('PUBLIC_SAFE', 'INTERNAL_ONLY', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "ProfessionalFactCategory" AS ENUM ('SKILL', 'CAREER', 'EDUCATION', 'LEADERSHIP', 'ARCHITECTURE', 'METRIC', 'LANGUAGE', 'POSITIONING');

-- CreateEnum
CREATE TYPE "KnowledgeEvidenceStatus" AS ENUM ('VERIFIED', 'DOCUMENTED', 'USER_CONFIRMED', 'NEEDS_REVIEW', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "ImplementationStatus" AS ENUM ('IMPLEMENTED', 'USED_IN_PORTFOLIO', 'GENERAL_KNOWLEDGE', 'PLANNED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PortfolioProjectKind" AS ENUM ('PORTFOLIO', 'SYNTHETIC_DEMO', 'ACADEMIC', 'OPEN_SOURCE', 'PLANNED');

-- CreateEnum
CREATE TYPE "KnowledgeImportStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "QualityGateStatus" AS ENUM ('PASS', 'NEEDS_REVISION', 'BLOCKED');

-- CreateTable
CREATE TABLE "EditorialLine" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "themes" JSONB NOT NULL,
    "toneOfVoice" TEXT NOT NULL,
    "aidaRules" TEXT NOT NULL,
    "cvCases" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "lastStockRefillAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" UUID NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "type" "KnowledgeSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "uri" TEXT,
    "contentHash" TEXT NOT NULL,
    "trustLevel" "KnowledgeTrustLevel" NOT NULL,
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'INTERNAL_ONLY',
    "asOf" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalFact" (
    "id" UUID NOT NULL,
    "factKey" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "category" "ProfessionalFactCategory" NOT NULL,
    "evidenceStatus" "KnowledgeEvidenceStatus" NOT NULL,
    "implementationStatus" "ImplementationStatus" NOT NULL,
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'INTERNAL_ONLY',
    "publicAllowed" BOOLEAN NOT NULL DEFAULT false,
    "confidentialityNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalFactSource" (
    "factId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "excerpt" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "ProfessionalFactSource_pkey" PRIMARY KEY ("factId","sourceId")
);

-- CreateTable
CREATE TABLE "ProfessionalExperience" (
    "id" UUID NOT NULL,
    "experienceKey" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "current" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "technologies" JSONB NOT NULL,
    "editorialAngles" JSONB,
    "evidenceStatus" "KnowledgeEvidenceStatus" NOT NULL,
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'INTERNAL_ONLY',
    "publicAllowed" BOOLEAN NOT NULL DEFAULT false,
    "confidentialityNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperienceSource" (
    "experienceId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,

    CONSTRAINT "ExperienceSource_pkey" PRIMARY KEY ("experienceId","sourceId")
);

-- CreateTable
CREATE TABLE "PortfolioProject" (
    "id" UUID NOT NULL,
    "projectKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PortfolioProjectKind" NOT NULL,
    "publicUrl" TEXT,
    "summary" TEXT NOT NULL,
    "technologies" JSONB NOT NULL,
    "themes" JSONB,
    "limitations" JSONB,
    "implementationStatus" "ImplementationStatus" NOT NULL,
    "evidenceStatus" "KnowledgeEvidenceStatus" NOT NULL,
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'PUBLIC_SAFE',
    "publicAllowed" BOOLEAN NOT NULL DEFAULT true,
    "confidentialityNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSource" (
    "projectId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,

    CONSTRAINT "ProjectSource_pkey" PRIMARY KEY ("projectId","sourceId")
);

-- CreateTable
CREATE TABLE "KnowledgeImportRun" (
    "id" UUID NOT NULL,
    "importKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "KnowledgeImportStatus" NOT NULL,
    "filesProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" UUID NOT NULL,
    "generationKey" TEXT,
    "editorialLineId" UUID,
    "editorialPillar" "EditorialPillar" NOT NULL DEFAULT 'TOFU',
    "funnelStage" "FunnelStage" NOT NULL,
    "formatType" "FormatType" NOT NULL,
    "title" TEXT NOT NULL,
    "textContent" TEXT NOT NULL,
    "imagePrompt" TEXT,
    "slidesJson" JSONB,
    "mediaUrl" TEXT,
    "status" "PostStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "scheduledDate" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "linkedinPostId" TEXT,
    "engagementScore" DOUBLE PRECISION,
    "engagementLabel" TEXT,
    "qualityScore" DOUBLE PRECISION,
    "qualityStatus" "QualityGateStatus",
    "qualityReview" JSONB,
    "qualityReviewedAt" TIMESTAMP(3),
    "feedbackText" TEXT,
    "rejectionFeedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMetric" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "profileViews" INTEGER NOT NULL DEFAULT 0,
    "engagementScore" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentReference" (
    "id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectionPattern" (
    "id" UUID NOT NULL,
    "pattern" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "lastFeedback" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RejectionPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "about" TEXT NOT NULL,
    "location" TEXT,
    "linkedinUrl" TEXT,
    "skills" JSONB NOT NULL,
    "experience" JSONB,
    "education" JSONB,
    "targetTitles" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerDocument" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeDraft" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "sourceJobId" UUID,
    "targetRole" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "jobDescription" TEXT,
    "content" JSONB NOT NULL,
    "atsScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "validation" JSONB,
    "status" "ResumeDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobListing" (
    "id" UUID NOT NULL,
    "source" "JobSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT,
    "location" TEXT,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourcePublishedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "JobListingStatus" NOT NULL DEFAULT 'OPEN',
    "rawData" JSONB,

    CONSTRAINT "JobListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMatch" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "matchedSkills" JSONB NOT NULL,
    "skillGaps" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "ragContext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedInSeoAudit" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "strengths" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedInSeoAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillRadar" (
    "id" UUID NOT NULL,
    "skill" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "demandCount" INTEGER NOT NULL DEFAULT 0,
    "candidateLevel" DOUBLE PRECISION,
    "gapScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillRadar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerSearchRun" (
    "id" UUID NOT NULL,
    "status" "SearchRunStatus" NOT NULL DEFAULT 'RUNNING',
    "queryCount" INTEGER NOT NULL DEFAULT 0,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CareerSearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_sourceKey_key" ON "KnowledgeSource"("sourceKey");

-- CreateIndex
CREATE INDEX "KnowledgeSource_type_trustLevel_idx" ON "KnowledgeSource"("type", "trustLevel");

-- CreateIndex
CREATE INDEX "KnowledgeSource_contentHash_idx" ON "KnowledgeSource"("contentHash");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_sourceId_idx" ON "KnowledgeDocument"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocument_sourceId_contentHash_key" ON "KnowledgeDocument"("sourceId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalFact_factKey_key" ON "ProfessionalFact"("factKey");

-- CreateIndex
CREATE INDEX "ProfessionalFact_category_evidenceStatus_idx" ON "ProfessionalFact"("category", "evidenceStatus");

-- CreateIndex
CREATE INDEX "ProfessionalFact_publicAllowed_visibility_idx" ON "ProfessionalFact"("publicAllowed", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalExperience_experienceKey_key" ON "ProfessionalExperience"("experienceKey");

-- CreateIndex
CREATE INDEX "ProfessionalExperience_company_current_idx" ON "ProfessionalExperience"("company", "current");

-- CreateIndex
CREATE INDEX "ProfessionalExperience_publicAllowed_evidenceStatus_idx" ON "ProfessionalExperience"("publicAllowed", "evidenceStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioProject_projectKey_key" ON "PortfolioProject"("projectKey");

-- CreateIndex
CREATE INDEX "PortfolioProject_kind_implementationStatus_idx" ON "PortfolioProject"("kind", "implementationStatus");

-- CreateIndex
CREATE INDEX "PortfolioProject_publicAllowed_evidenceStatus_idx" ON "PortfolioProject"("publicAllowed", "evidenceStatus");

-- CreateIndex
CREATE INDEX "KnowledgeImportRun_status_startedAt_idx" ON "KnowledgeImportRun"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeImportRun_importKey_contentHash_key" ON "KnowledgeImportRun"("importKey", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Post_generationKey_key" ON "Post"("generationKey");

-- CreateIndex
CREATE INDEX "Post_status_scheduledFor_idx" ON "Post"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Post_editorialLineId_idx" ON "Post"("editorialLineId");

-- CreateIndex
CREATE INDEX "Post_editorialLineId_editorialPillar_status_engagementScore_idx" ON "Post"("editorialLineId", "editorialPillar", "status", "engagementScore");

-- CreateIndex
CREATE INDEX "Post_qualityStatus_qualityScore_idx" ON "Post"("qualityStatus", "qualityScore");

-- CreateIndex
CREATE INDEX "PostMetric_postId_capturedAt_idx" ON "PostMetric"("postId", "capturedAt");

-- CreateIndex
CREATE INDEX "PostMetric_engagementScore_idx" ON "PostMetric"("engagementScore");

-- CreateIndex
CREATE INDEX "ContentReference_createdAt_idx" ON "ContentReference"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RejectionPattern_pattern_key" ON "RejectionPattern"("pattern");

-- CreateIndex
CREATE INDEX "RejectionPattern_lastSeenAt_idx" ON "RejectionPattern"("lastSeenAt");

-- CreateIndex
CREATE INDEX "RejectionPattern_occurrenceCount_idx" ON "RejectionPattern"("occurrenceCount");

-- CreateIndex
CREATE INDEX "CareerDocument_profileId_createdAt_idx" ON "CareerDocument"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "ResumeDraft_profileId_updatedAt_idx" ON "ResumeDraft"("profileId", "updatedAt");

-- CreateIndex
CREATE INDEX "ResumeDraft_targetRole_atsScore_idx" ON "ResumeDraft"("targetRole", "atsScore");

-- CreateIndex
CREATE INDEX "JobListing_status_discoveredAt_idx" ON "JobListing"("status", "discoveredAt");

-- CreateIndex
CREATE INDEX "JobListing_title_location_idx" ON "JobListing"("title", "location");

-- CreateIndex
CREATE UNIQUE INDEX "JobListing_source_externalId_key" ON "JobListing"("source", "externalId");

-- CreateIndex
CREATE INDEX "JobMatch_profileId_score_idx" ON "JobMatch"("profileId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "JobMatch_profileId_jobId_key" ON "JobMatch"("profileId", "jobId");

-- CreateIndex
CREATE INDEX "LinkedInSeoAudit_profileId_createdAt_idx" ON "LinkedInSeoAudit"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "SkillRadar_gapScore_idx" ON "SkillRadar"("gapScore");

-- CreateIndex
CREATE UNIQUE INDEX "SkillRadar_skill_category_key" ON "SkillRadar"("skill", "category");

-- CreateIndex
CREATE INDEX "CareerSearchRun_status_startedAt_idx" ON "CareerSearchRun"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalFactSource" ADD CONSTRAINT "ProfessionalFactSource_factId_fkey" FOREIGN KEY ("factId") REFERENCES "ProfessionalFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalFactSource" ADD CONSTRAINT "ProfessionalFactSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceSource" ADD CONSTRAINT "ExperienceSource_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "ProfessionalExperience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceSource" ADD CONSTRAINT "ExperienceSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSource" ADD CONSTRAINT "ProjectSource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PortfolioProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSource" ADD CONSTRAINT "ProjectSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_editorialLineId_fkey" FOREIGN KEY ("editorialLineId") REFERENCES "EditorialLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetric" ADD CONSTRAINT "PostMetric_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerDocument" ADD CONSTRAINT "CareerDocument_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeDraft" ADD CONSTRAINT "ResumeDraft_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeDraft" ADD CONSTRAINT "ResumeDraft_sourceJobId_fkey" FOREIGN KEY ("sourceJobId") REFERENCES "JobListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedInSeoAudit" ADD CONSTRAINT "LinkedInSeoAudit_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
