CREATE TYPE "JobApplicationStatus" AS ENUM (
  'SAVED',
  'READY_FOR_REVIEW',
  'RESUME_PREPARED',
  'APPLIED',
  'INTERVIEW',
  'REJECTED',
  'WITHDRAWN'
);

CREATE TABLE "JobSearchPreference" (
  "id" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "targetTitles" JSONB NOT NULL,
  "locations" JSONB NOT NULL,
  "minimumMatchScore" INTEGER NOT NULL DEFAULT 70,
  "remoteOnly" BOOLEAN NOT NULL DEFAULT false,
  "autoApplyEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobSearchPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobApplication" (
  "id" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "resumeDraftId" UUID,
  "status" "JobApplicationStatus" NOT NULL DEFAULT 'SAVED',
  "notes" TEXT,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobSearchPreference_profileId_key" ON "JobSearchPreference"("profileId");
CREATE UNIQUE INDEX "JobApplication_profileId_jobId_key" ON "JobApplication"("profileId", "jobId");
CREATE INDEX "JobApplication_profileId_status_updatedAt_idx" ON "JobApplication"("profileId", "status", "updatedAt");
CREATE INDEX "JobApplication_jobId_status_idx" ON "JobApplication"("jobId", "status");

ALTER TABLE "JobSearchPreference" ADD CONSTRAINT "JobSearchPreference_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "JobListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_resumeDraftId_fkey"
  FOREIGN KEY ("resumeDraftId") REFERENCES "ResumeDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
