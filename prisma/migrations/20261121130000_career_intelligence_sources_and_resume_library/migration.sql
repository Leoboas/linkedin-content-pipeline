CREATE TYPE "JobEligibilityStatus" AS ENUM ('ELIGIBLE', 'RESTRICTED', 'UNKNOWN');
CREATE TYPE "AuthorizedResumeProfile" AS ENUM ('DATA_ENGINEERING', 'PYTHON_BACKEND');
CREATE TYPE "AuthorizedResumeLanguage" AS ENUM ('PT_BR', 'EN');

ALTER TABLE "JobSearchPreference" ALTER COLUMN "minimumMatchScore" SET DEFAULT 65;

ALTER TABLE "CareerSearchRun"
  ALTER COLUMN "status" SET DEFAULT 'QUEUED',
  ADD COLUMN "savedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discardedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "errorCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "parameters" JSONB,
  ADD COLUMN "sourceResults" JSONB,
  ADD COLUMN "executionStartedAt" TIMESTAMP(3);

ALTER TABLE "JobMatch"
  ADD COLUMN "eligibilityStatus" "JobEligibilityStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "eligibilityReasons" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "evidenceConfidence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recommendedResumeId" UUID,
  ADD COLUMN "recommendedResumeReason" TEXT;

CREATE TABLE "AuthorizedResume" (
  "id" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "resumeKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "profileType" "AuthorizedResumeProfile" NOT NULL,
  "language" "AuthorizedResumeLanguage" NOT NULL,
  "version" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "fileData" BYTEA NOT NULL,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthorizedResume_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "JobApplication"
  ADD COLUMN "authorizedResumeId" UUID,
  ADD COLUMN "submissionEvidence" TEXT,
  ADD COLUMN "submissionEvidenceAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "AuthorizedResume_resumeKey_key" ON "AuthorizedResume"("resumeKey");
CREATE INDEX "AuthorizedResume_profileId_profileType_language_idx" ON "AuthorizedResume"("profileId", "profileType", "language");
CREATE INDEX "JobMatch_eligibilityStatus_score_idx" ON "JobMatch"("eligibilityStatus", "score");
CREATE INDEX "JobMatch_recommendedResumeId_idx" ON "JobMatch"("recommendedResumeId");

ALTER TABLE "AuthorizedResume" ADD CONSTRAINT "AuthorizedResume_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_recommendedResumeId_fkey"
  FOREIGN KEY ("recommendedResumeId") REFERENCES "AuthorizedResume"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_authorizedResumeId_fkey"
  FOREIGN KEY ("authorizedResumeId") REFERENCES "AuthorizedResume"("id") ON DELETE SET NULL ON UPDATE CASCADE;
