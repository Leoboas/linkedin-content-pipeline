ALTER TYPE "JobEligibilityStatus" ADD VALUE IF NOT EXISTS 'BRAZIL_ELIGIBLE';
ALTER TYPE "JobEligibilityStatus" ADD VALUE IF NOT EXISTS 'LATAM_ELIGIBLE';
ALTER TYPE "JobEligibilityStatus" ADD VALUE IF NOT EXISTS 'WORLDWIDE_ELIGIBLE';
ALTER TYPE "JobEligibilityStatus" ADD VALUE IF NOT EXISTS 'RELOCATION_REQUIRED';
ALTER TYPE "JobEligibilityStatus" ADD VALUE IF NOT EXISTS 'REGION_RESTRICTED';

ALTER TABLE "JobSearchPreference"
  ADD COLUMN "sourceKeys" JSONB NOT NULL DEFAULT '["CODERIO_LEVER","HIMALAYAS","REMOTIVE","REMOTE_OK","WE_WORK_REMOTELY"]'::jsonb,
  ADD COLUMN "employerMarkets" JSONB NOT NULL DEFAULT '["US","EU","GLOBAL"]'::jsonb;

CREATE TABLE "MonitoredCompany" (
  "id" UUID NOT NULL,
  "companyKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "careersUrl" TEXT NOT NULL,
  "atsType" TEXT NOT NULL,
  "boardSlug" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonitoredCompany_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonitoredCompany_companyKey_key" ON "MonitoredCompany"("companyKey");
CREATE INDEX "MonitoredCompany_active_priority_idx" ON "MonitoredCompany"("active", "priority");

INSERT INTO "MonitoredCompany" ("id", "companyKey", "name", "careersUrl", "atsType", "boardSlug", "priority", "active", "updatedAt")
VALUES ('a4d78d17-4524-4e7b-a8d2-1ba6e3a4c001', 'CODERIO', 'Coderio', 'https://jobs.lever.co/coderio', 'LEVER', 'coderio', 1, true, CURRENT_TIMESTAMP)
ON CONFLICT ("companyKey") DO NOTHING;
