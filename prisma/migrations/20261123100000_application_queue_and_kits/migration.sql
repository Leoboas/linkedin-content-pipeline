-- Additive Career CRM migration. Existing applications remain in NOT_QUEUED;
-- no historical opportunities are automatically sent to document preparation.
CREATE TYPE "ApplicationPreparationStatus" AS ENUM (
  'NOT_QUEUED',
  'QUEUED',
  'PREPARING',
  'NEEDS_INFORMATION',
  'READY_FOR_REVIEW',
  'APPROVED_FOR_SUBMISSION',
  'SUBMITTING',
  'SUBMISSION_FAILED',
  'MANUAL_ACTION_REQUIRED'
);

CREATE TYPE "ApplicationKitReviewStatus" AS ENUM (
  'NEEDS_REVIEW',
  'NEEDS_INFORMATION',
  'APPROVED',
  'REJECTED'
);

CREATE TYPE "JobApplicationEventType" AS ENUM (
  'PREPARATION_STATUS_CHANGED',
  'RECRUITMENT_STATUS_CHANGED',
  'KIT_CREATED',
  'KIT_APPROVED',
  'NOTE_ADDED',
  'RECRUITER_CONTACT_RECORDED',
  'INTERVIEW_RECORDED'
);

ALTER TYPE "JobApplicationStatus" ADD VALUE IF NOT EXISTS 'SCREENING';
ALTER TYPE "JobApplicationStatus" ADD VALUE IF NOT EXISTS 'TECHNICAL_TEST';
ALTER TYPE "JobApplicationStatus" ADD VALUE IF NOT EXISTS 'OFFER';
ALTER TYPE "JobApplicationStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

ALTER TABLE "JobApplication"
  ADD COLUMN "preparationStatus" "ApplicationPreparationStatus" NOT NULL DEFAULT 'NOT_QUEUED',
  ADD COLUMN "preparationAttempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recruiterContact" TEXT;

CREATE TABLE "JobApplicationEvent" (
  "id" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "eventType" "JobApplicationEventType" NOT NULL,
  "fromRecruitmentStage" TEXT,
  "toRecruitmentStage" TEXT,
  "fromPreparationStage" TEXT,
  "toPreparationStage" TEXT,
  "source" TEXT NOT NULL DEFAULT 'USER',
  "note" TEXT,
  "details" JSONB,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobApplicationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationKit" (
  "id" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "requestKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "baseResumeId" UUID,
  "resumeDraftId" UUID,
  "language" "AuthorizedResumeLanguage" NOT NULL,
  "tailoredResume" JSONB NOT NULL,
  "coverLetter" TEXT NOT NULL,
  "knownAnswers" JSONB NOT NULL DEFAULT '{}',
  "unverifiedRequirements" JSONB NOT NULL DEFAULT '[]',
  "requiredConfirmations" JSONB NOT NULL DEFAULT '[]',
  "submissionChecklist" JSONB NOT NULL DEFAULT '[]',
  "reviewStatus" "ApplicationKitReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "documentSha256" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApplicationKit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobApplicationEvent_idempotencyKey_key"
  ON "JobApplicationEvent"("idempotencyKey");
CREATE INDEX "JobApplicationEvent_applicationId_createdAt_idx"
  ON "JobApplicationEvent"("applicationId", "createdAt");
CREATE INDEX "JobApplicationEvent_eventType_createdAt_idx"
  ON "JobApplicationEvent"("eventType", "createdAt");
CREATE INDEX "JobApplication_preparationStatus_updatedAt_idx"
  ON "JobApplication"("preparationStatus", "updatedAt");
CREATE UNIQUE INDEX "ApplicationKit_applicationId_version_key"
  ON "ApplicationKit"("applicationId", "version");
CREATE UNIQUE INDEX "ApplicationKit_requestKey_key"
  ON "ApplicationKit"("requestKey");
CREATE INDEX "ApplicationKit_applicationId_createdAt_idx"
  ON "ApplicationKit"("applicationId", "createdAt");
CREATE INDEX "ApplicationKit_reviewStatus_createdAt_idx"
  ON "ApplicationKit"("reviewStatus", "createdAt");

ALTER TABLE "JobApplicationEvent"
  ADD CONSTRAINT "JobApplicationEvent_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationKit"
  ADD CONSTRAINT "ApplicationKit_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ApplicationKit_baseResumeId_fkey"
  FOREIGN KEY ("baseResumeId") REFERENCES "AuthorizedResume"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ApplicationKit_resumeDraftId_fkey"
  FOREIGN KEY ("resumeDraftId") REFERENCES "ResumeDraft"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
