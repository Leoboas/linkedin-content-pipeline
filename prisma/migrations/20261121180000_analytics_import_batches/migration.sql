-- Additive analytics import provenance and per-post audience distribution.
-- Existing metric snapshots and posts are preserved unchanged.
ALTER TABLE "PostMetric"
  ADD COLUMN "impressionsInNetwork" INTEGER,
  ADD COLUMN "impressionsOutOfNetwork" INTEGER,
  ADD COLUMN "inNetworkPercent" DOUBLE PRECISION,
  ADD COLUMN "outOfNetworkPercent" DOUBLE PRECISION,
  ADD COLUMN "audienceBreakdown" JSONB,
  ADD COLUMN "sourceNote" TEXT,
  ADD COLUMN "latenessHours" DOUBLE PRECISION,
  ADD COLUMN "importBatchId" UUID,
  ADD COLUMN "importRowNumber" INTEGER;

CREATE TABLE "AnalyticsImportBatch" (
  "id" UUID NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileSha256" TEXT NOT NULL,
  "sourceLabel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "columnMapping" JSONB NOT NULL,
  "mappingHistory" JSONB,
  "rowsSeen" INTEGER NOT NULL DEFAULT 0,
  "rowsImported" INTEGER NOT NULL DEFAULT 0,
  "rowsUnmatched" INTEGER NOT NULL DEFAULT 0,
  "errors" JSONB,
  "aggregateRows" JSONB,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsImportBatch_fileSha256_key" ON "AnalyticsImportBatch"("fileSha256");
CREATE INDEX "AnalyticsImportBatch_capturedAt_idx" ON "AnalyticsImportBatch"("capturedAt");
CREATE INDEX "AnalyticsImportBatch_status_createdAt_idx" ON "AnalyticsImportBatch"("status", "createdAt");
CREATE INDEX "PostMetric_importBatchId_idx" ON "PostMetric"("importBatchId");

ALTER TABLE "PostMetric"
  ADD CONSTRAINT "PostMetric_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "AnalyticsImportBatch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AnalyticsCollectionAttempt" (
  "id" UUID NOT NULL,
  "postId" UUID NOT NULL,
  "linkedinPostId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'LINKEDIN_API',
  "measurementWindow" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "apiVersion" TEXT,
  "estimatedApiCalls" INTEGER NOT NULL DEFAULT 0,
  "errorCategory" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "AnalyticsCollectionAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsCollectionAttempt_postId_measurementWindow_requestedAt_idx"
  ON "AnalyticsCollectionAttempt"("postId", "measurementWindow", "requestedAt");
CREATE INDEX "AnalyticsCollectionAttempt_state_requestedAt_idx"
  ON "AnalyticsCollectionAttempt"("state", "requestedAt");
ALTER TABLE "AnalyticsCollectionAttempt"
  ADD CONSTRAINT "AnalyticsCollectionAttempt_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
