-- Additive browser-executor metadata. Existing API-authorized submissions keep
-- executorMode=SERVER_API and are untouched.
ALTER TABLE "ApplicationSubmission"
  ADD COLUMN "executorMode" TEXT NOT NULL DEFAULT 'SERVER_API',
  ADD COLUMN "executorTokenHash" TEXT,
  ADD COLUMN "executorTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "executorClaimedAt" TIMESTAMP(3),
  ADD COLUMN "executorCompletedAt" TIMESTAMP(3),
  ADD COLUMN "executorAttempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "executorEvidence" JSONB;

CREATE INDEX "ApplicationSubmission_executorTokenHash_idx" ON "ApplicationSubmission"("executorTokenHash");
CREATE INDEX "ApplicationSubmission_executorMode_state_executorTokenExpiresAt_idx" ON "ApplicationSubmission"("executorMode", "state", "executorTokenExpiresAt");
