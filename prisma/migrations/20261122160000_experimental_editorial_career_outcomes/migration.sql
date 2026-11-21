CREATE TYPE "EditorialExperimentStatus" AS ENUM (
  'PLANNED', 'RUNNING', 'INSUFFICIENT_DATA', 'READY_FOR_REVIEW', 'COMPLETED', 'CANCELLED'
);
CREATE TYPE "EditorialRecommendationStatus" AS ENUM (
  'SUGGESTED', 'APPROVED', 'REJECTED', 'DEFERRED', 'APPLIED'
);
CREATE TYPE "CareerOutcomeOrigin" AS ENUM (
  'POST_CONFIRMED', 'NETWORKING_CONFIRMED', 'LINKEDIN_SEARCH', 'DIRECT_APPLICATION', 'REFERRAL', 'OTHER', 'UNKNOWN'
);
CREATE TYPE "CareerOutcomeType" AS ENUM (
  'RECRUITER_CONTACT', 'HIRING_MANAGER_CONVERSATION', 'PROFESSIONAL_CONNECTION', 'INTERVIEW_INVITATION', 'QUALIFIED_OPPORTUNITY', 'OTHER'
);
CREATE TYPE "CareerOutcomeStage" AS ENUM (
  'CONTACTED', 'CONVERSATION', 'INTERVIEW', 'OPPORTUNITY', 'OFFER', 'CLOSED', 'UNKNOWN'
);
CREATE TYPE "CareerOutcomeAssociation" AS ENUM (
  'CONFIRMED', 'HYPOTHESIS', 'UNLINKED'
);

CREATE TABLE "EditorialLearningCycle" (
  "id" UUID NOT NULL,
  "cycleKey" TEXT NOT NULL DEFAULT 'primary',
  "startDate" DATE NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "plannedPostsPerWeek" INTEGER NOT NULL DEFAULT 4,
  "languageDistribution" JSONB NOT NULL DEFAULT '{"en-US":2,"pt-BR":2}',
  "scheduleSnapshot" JSONB NOT NULL DEFAULT '[{"weekday":1,"localTime":"13:00","language":"en-US"},{"weekday":2,"localTime":"16:00","language":"pt-BR"},{"weekday":4,"localTime":"13:00","language":"en-US"},{"weekday":5,"localTime":"16:00","language":"pt-BR"}]',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EditorialLearningCycle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EditorialLearningCycle_cycleKey_key" ON "EditorialLearningCycle"("cycleKey");

CREATE TABLE "EditorialExperiment" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "hypothesis" TEXT NOT NULL,
  "professionalObjective" TEXT NOT NULL,
  "primaryMetric" TEXT NOT NULL,
  "secondaryMetrics" JSONB NOT NULL DEFAULT '[]',
  "variableTested" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "comparisonCriteria" JSONB NOT NULL DEFAULT '{}',
  "minimumObservations" INTEGER NOT NULL DEFAULT 4,
  "status" "EditorialExperimentStatus" NOT NULL DEFAULT 'PLANNED',
  "results" JSONB,
  "limitations" JSONB,
  "recommendation" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EditorialExperiment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EditorialExperiment_status_periodStart_periodEnd_idx" ON "EditorialExperiment"("status", "periodStart", "periodEnd");
CREATE INDEX "EditorialExperiment_variableTested_primaryMetric_idx" ON "EditorialExperiment"("variableTested", "primaryMetric");

CREATE TABLE "EditorialExperimentEvaluation" (
  "id" UUID NOT NULL,
  "experimentId" UUID NOT NULL,
  "measurementWindow" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "dataFingerprint" TEXT NOT NULL,
  "results" JSONB NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EditorialExperimentEvaluation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EditorialExperimentEvaluation_experimentId_dataFingerprint_key" ON "EditorialExperimentEvaluation"("experimentId", "dataFingerprint");
CREATE INDEX "EditorialExperimentEvaluation_experimentId_observedAt_idx" ON "EditorialExperimentEvaluation"("experimentId", "observedAt");
ALTER TABLE "EditorialExperimentEvaluation" ADD CONSTRAINT "EditorialExperimentEvaluation_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "EditorialExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EditorialExperimentPost" (
  "experimentId" UUID NOT NULL,
  "postId" UUID NOT NULL,
  "armLabel" TEXT NOT NULL,
  "notes" TEXT,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EditorialExperimentPost_pkey" PRIMARY KEY ("experimentId", "postId")
);
CREATE INDEX "EditorialExperimentPost_postId_idx" ON "EditorialExperimentPost"("postId");

CREATE TABLE "EditorialRecommendation" (
  "id" UUID NOT NULL,
  "recommendationKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "diagnosis" TEXT NOT NULL,
  "dataSnapshot" JSONB NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "sampleSize" INTEGER NOT NULL DEFAULT 0,
  "hypothesis" TEXT NOT NULL,
  "justification" TEXT NOT NULL,
  "confidence" TEXT NOT NULL DEFAULT 'LOW',
  "nextAction" TEXT NOT NULL,
  "limitations" JSONB NOT NULL,
  "status" "EditorialRecommendationStatus" NOT NULL DEFAULT 'SUGGESTED',
  "decisionNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EditorialRecommendation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EditorialRecommendation_recommendationKey_key" ON "EditorialRecommendation"("recommendationKey");
CREATE INDEX "EditorialRecommendation_status_createdAt_idx" ON "EditorialRecommendation"("status", "createdAt");
CREATE INDEX "EditorialRecommendation_periodStart_periodEnd_idx" ON "EditorialRecommendation"("periodStart", "periodEnd");

CREATE TABLE "QualifiedAudienceCriteria" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL DEFAULT 'primary',
  "roles" JSONB NOT NULL DEFAULT '["Data Engineer","Backend Engineer","Senior Software Engineer","Staff Engineer","Principal Engineer","Tech Lead","Software Architect","Engineering Manager","Hiring Manager","Technical Recruiter"]',
  "markets" JSONB NOT NULL DEFAULT '["BR","US","EU"]',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualifiedAudienceCriteria_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QualifiedAudienceCriteria_key_key" ON "QualifiedAudienceCriteria"("key");

CREATE TABLE "CareerOutcome" (
  "id" UUID NOT NULL,
  "company" TEXT,
  "contactName" TEXT,
  "contactRole" TEXT,
  "roleTitle" TEXT,
  "market" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "type" "CareerOutcomeType" NOT NULL,
  "origin" "CareerOutcomeOrigin" NOT NULL DEFAULT 'UNKNOWN',
  "association" "CareerOutcomeAssociation" NOT NULL DEFAULT 'UNLINKED',
  "postId" UUID,
  "networkingActivityId" UUID,
  "jobApplicationId" UUID,
  "processStage" "CareerOutcomeStage" NOT NULL DEFAULT 'UNKNOWN',
  "observation" TEXT,
  "result" TEXT,
  "evidenceNote" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareerOutcome_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CareerOutcome_idempotencyKey_key" ON "CareerOutcome"("idempotencyKey");
CREATE INDEX "CareerOutcome_occurredAt_type_idx" ON "CareerOutcome"("occurredAt", "type");
CREATE INDEX "CareerOutcome_origin_association_idx" ON "CareerOutcome"("origin", "association");
CREATE INDEX "CareerOutcome_company_occurredAt_idx" ON "CareerOutcome"("company", "occurredAt");
CREATE INDEX "CareerOutcome_postId_idx" ON "CareerOutcome"("postId");
CREATE INDEX "CareerOutcome_networkingActivityId_idx" ON "CareerOutcome"("networkingActivityId");
CREATE INDEX "CareerOutcome_jobApplicationId_idx" ON "CareerOutcome"("jobApplicationId");

ALTER TABLE "EditorialExperimentPost"
  ADD CONSTRAINT "EditorialExperimentPost_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "EditorialExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EditorialExperimentPost_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareerOutcome"
  ADD CONSTRAINT "CareerOutcome_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CareerOutcome_networkingActivityId_fkey" FOREIGN KEY ("networkingActivityId") REFERENCES "NetworkingActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CareerOutcome_jobApplicationId_fkey" FOREIGN KEY ("jobApplicationId") REFERENCES "JobApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
