-- Analytics snapshots preserve unavailable values as NULL and tag legacy
-- records whose old zero defaults cannot be interpreted safely.
ALTER TABLE "PostMetric"
  ALTER COLUMN "impressions" DROP DEFAULT,
  ALTER COLUMN "impressions" DROP NOT NULL,
  ALTER COLUMN "reactions" DROP DEFAULT,
  ALTER COLUMN "reactions" DROP NOT NULL,
  ALTER COLUMN "comments" DROP DEFAULT,
  ALTER COLUMN "comments" DROP NOT NULL,
  ALTER COLUMN "shares" DROP DEFAULT,
  ALTER COLUMN "shares" DROP NOT NULL,
  ALTER COLUMN "profileViews" DROP DEFAULT,
  ALTER COLUMN "profileViews" DROP NOT NULL;

ALTER TABLE "PostMetric"
  ADD COLUMN "linkedinPostId" TEXT,
  ADD COLUMN "membersReached" INTEGER,
  ADD COLUMN "postSaves" INTEGER,
  ADD COLUMN "postSends" INTEGER,
  ADD COLUMN "linkClicks" INTEGER,
  ADD COLUMN "premiumCtaClicks" INTEGER,
  ADD COLUMN "followersGained" INTEGER,
  ADD COLUMN "profileViewsFromContent" INTEGER,
  ADD COLUMN "interactionRate" DOUBLE PRECISION,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "apiVersion" TEXT,
  ADD COLUMN "measurementWindow" TEXT NOT NULL DEFAULT 'LIFETIME',
  ADD COLUMN "availability" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "publishedAtSnapshot" TIMESTAMP(3),
  ADD COLUMN "exposureHours" DOUBLE PRECISION,
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "PostMetric_idempotencyKey_key" ON "PostMetric"("idempotencyKey");
CREATE INDEX "PostMetric_postId_measurementWindow_source_idx"
  ON "PostMetric"("postId", "measurementWindow", "source");

CREATE TABLE "ProfileMetric" (
  "id" UUID NOT NULL,
  "metricType" TEXT NOT NULL,
  "value" INTEGER,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "sourceNote" TEXT,
  "apiVersion" TEXT,
  "availability" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotencyKey" TEXT,
  CONSTRAINT "ProfileMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfileMetric_idempotencyKey_key" ON "ProfileMetric"("idempotencyKey");
CREATE INDEX "ProfileMetric_metricType_capturedAt_idx" ON "ProfileMetric"("metricType", "capturedAt");
CREATE INDEX "ProfileMetric_source_capturedAt_idx" ON "ProfileMetric"("source", "capturedAt");
