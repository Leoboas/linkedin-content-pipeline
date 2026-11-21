-- Networking Intelligence: private, user-entered references and manual activity only.
-- No LinkedIn scraping, automatic engagement, or changes to existing content/career rows.
CREATE TYPE "NetworkingReferenceStatus" AS ENUM ('SAVED', 'REVIEWED', 'COMMENT_PREPARED', 'INTERACTED', 'ARCHIVED');
CREATE TYPE "NetworkingActivityType" AS ENUM ('DISCUSSION_REVIEWED', 'COMMENT_PREPARED', 'COMMENT_PUBLISHED', 'REPLY_RECEIVED', 'RELEVANT_CONNECTION', 'PROFESSIONAL_CONVERSATION');
CREATE TYPE "NetworkingTargetType" AS ENUM ('PROFESSIONAL', 'COMPANY');
CREATE TYPE "NetworkingCommentApproach" AS ENUM ('TECHNICAL_INSIGHT', 'TRADE_OFF', 'PRACTICAL_EXAMPLE', 'TECHNICAL_QUESTION', 'CONSTRUCTIVE_COUNTERPOINT');
CREATE TYPE "NetworkingAiAttemptStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

CREATE TABLE "NetworkingTopic" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "keywords" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 50,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NetworkingTopic_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NetworkingTopic_key_key" ON "NetworkingTopic"("key");
CREATE INDEX "NetworkingTopic_active_priority_idx" ON "NetworkingTopic"("active", "priority");

CREATE TABLE "NetworkingReference" (
  "id" UUID NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "sourceDomain" TEXT NOT NULL,
  "authorName" TEXT,
  "authorRole" TEXT,
  "companyName" TEXT,
  "title" TEXT,
  "summary" TEXT,
  "content" TEXT NOT NULL DEFAULT '',
  "language" TEXT NOT NULL DEFAULT 'unknown',
  "topicKey" TEXT,
  "relevanceScore" INTEGER NOT NULL DEFAULT 0,
  "relevanceRationale" JSONB,
  "status" "NetworkingReferenceStatus" NOT NULL DEFAULT 'SAVED',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "NetworkingReference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NetworkingReference_canonicalUrl_key" ON "NetworkingReference"("canonicalUrl");
CREATE INDEX "NetworkingReference_status_createdAt_idx" ON "NetworkingReference"("status", "createdAt");
CREATE INDEX "NetworkingReference_topicKey_language_status_idx" ON "NetworkingReference"("topicKey", "language", "status");
CREATE INDEX "NetworkingReference_companyName_idx" ON "NetworkingReference"("companyName");

CREATE TABLE "NetworkingCommentDraft" (
  "id" UUID NOT NULL,
  "referenceId" UUID NOT NULL,
  "approach" "NetworkingCommentApproach" NOT NULL,
  "comment" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NetworkingCommentDraft_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NetworkingCommentDraft_referenceId_createdAt_idx" ON "NetworkingCommentDraft"("referenceId", "createdAt");
CREATE INDEX "NetworkingCommentDraft_createdAt_idx" ON "NetworkingCommentDraft"("createdAt");
ALTER TABLE "NetworkingCommentDraft" ADD CONSTRAINT "NetworkingCommentDraft_referenceId_fkey"
  FOREIGN KEY ("referenceId") REFERENCES "NetworkingReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NetworkingAiAttempt" (
  "id" UUID NOT NULL,
  "referenceId" UUID NOT NULL,
  "status" "NetworkingAiAttemptStatus" NOT NULL DEFAULT 'STARTED',
  "errorCategory" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "NetworkingAiAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NetworkingAiAttempt_createdAt_status_idx" ON "NetworkingAiAttempt"("createdAt", "status");
CREATE INDEX "NetworkingAiAttempt_referenceId_createdAt_idx" ON "NetworkingAiAttempt"("referenceId", "createdAt");
ALTER TABLE "NetworkingAiAttempt" ADD CONSTRAINT "NetworkingAiAttempt_referenceId_fkey"
  FOREIGN KEY ("referenceId") REFERENCES "NetworkingReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NetworkingActivity" (
  "id" UUID NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "type" "NetworkingActivityType" NOT NULL,
  "referenceId" UUID,
  "commentDraftId" UUID,
  "topicKey" TEXT,
  "language" TEXT,
  "companyName" TEXT,
  "professionalRole" TEXT,
  "preparedComment" TEXT,
  "publishedComment" TEXT,
  "publicationConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "newRelevantConnection" BOOLEAN NOT NULL DEFAULT false,
  "conversationStarted" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NetworkingActivity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NetworkingActivity_idempotencyKey_key" ON "NetworkingActivity"("idempotencyKey");
CREATE INDEX "NetworkingActivity_occurredAt_type_idx" ON "NetworkingActivity"("occurredAt", "type");
CREATE INDEX "NetworkingActivity_topicKey_occurredAt_idx" ON "NetworkingActivity"("topicKey", "occurredAt");
ALTER TABLE "NetworkingActivity" ADD CONSTRAINT "NetworkingActivity_referenceId_fkey"
  FOREIGN KEY ("referenceId") REFERENCES "NetworkingReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NetworkingActivity" ADD CONSTRAINT "NetworkingActivity_commentDraftId_fkey"
  FOREIGN KEY ("commentDraftId") REFERENCES "NetworkingCommentDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "NetworkingRoutine" (
  "id" UUID NOT NULL,
  "localDate" DATE NOT NULL,
  "completed" JSONB NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NetworkingRoutine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NetworkingRoutine_localDate_key" ON "NetworkingRoutine"("localDate");

CREATE TABLE "NetworkingTarget" (
  "id" UUID NOT NULL,
  "targetKey" TEXT NOT NULL,
  "type" "NetworkingTargetType" NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT,
  "companyName" TEXT,
  "region" TEXT,
  "linkedinUrl" TEXT,
  "monitoredCompanyId" UUID,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NetworkingTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NetworkingTarget_targetKey_key" ON "NetworkingTarget"("targetKey");
CREATE UNIQUE INDEX "NetworkingTarget_linkedinUrl_key" ON "NetworkingTarget"("linkedinUrl");
CREATE INDEX "NetworkingTarget_type_companyName_idx" ON "NetworkingTarget"("type", "companyName");
CREATE INDEX "NetworkingTarget_monitoredCompanyId_idx" ON "NetworkingTarget"("monitoredCompanyId");
ALTER TABLE "NetworkingTarget" ADD CONSTRAINT "NetworkingTarget_monitoredCompanyId_fkey"
  FOREIGN KEY ("monitoredCompanyId") REFERENCES "MonitoredCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "NetworkingTopic" ("id", "key", "label", "keywords", "priority", "updatedAt") VALUES
  ('00000000-0000-4000-8000-000000000301', 'python', 'Python', '["python", "cpython", "asyncio"]', 10, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000302', 'fastapi', 'FastAPI', '["fastapi", "pydantic", "asgi"]', 20, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000303', 'data-engineering', 'Data Engineering', '["data engineering", "data engineer", "data platform"]', 30, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000304', 'sql-postgres', 'SQL & PostgreSQL', '["sql", "postgres", "postgresql", "query plan"]', 40, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000305', 'aws-cloud', 'AWS & Cloud Architecture', '["aws", "amazon web services", "cloud architecture"]', 50, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000306', 'spark-airflow', 'PySpark & Airflow', '["pyspark", "spark", "airflow", "orchestration"]', 60, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000307', 'etl-data-quality', 'ETL/ELT & Data Quality', '["etl", "elt", "data quality", "data freshness"]', 70, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000308', 'distributed-systems', 'Distributed Systems', '["distributed systems", "idempotency", "message queue", "event driven"]', 80, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000309', 'architecture-system-design', 'Software Architecture & System Design', '["software architecture", "system design", "clean architecture", "ddd"]', 90, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000310', 'observability-reliability', 'Observability & Reliability', '["observability", "reliability", "sre", "incident response"]', 100, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000311', 'technical-leadership', 'Technical Leadership', '["technical leadership", "engineering manager", "tech lead", "staff engineer"]', 110, CURRENT_TIMESTAMP);
