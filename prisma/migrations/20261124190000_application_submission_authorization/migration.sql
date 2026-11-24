-- Additive: existing approvals are not copied and never authorize a submission.
CREATE TABLE "ApplicationSubmission" (
  "id" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "kitId" UUID NOT NULL,
  "destinationUrl" TEXT NOT NULL,
  "formSnapshot" JSONB NOT NULL,
  "answersSnapshot" JSONB NOT NULL,
  "resumePdf" BYTEA NOT NULL,
  "coverLetterPdf" BYTEA NOT NULL,
  "packageHash" TEXT NOT NULL,
  "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "sandbox" BOOLEAN NOT NULL DEFAULT false,
  "state" TEXT NOT NULL DEFAULT 'QUEUED',
  "reason" TEXT,
  "portalReceipt" TEXT,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "submittingAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApplicationSubmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApplicationSubmission_kitId_key" ON "ApplicationSubmission"("kitId");
CREATE INDEX "ApplicationSubmission_state_dispatchedAt_idx" ON "ApplicationSubmission"("state", "dispatchedAt");
CREATE INDEX "ApplicationSubmission_applicationId_authorizedAt_idx" ON "ApplicationSubmission"("applicationId", "authorizedAt");
ALTER TABLE "ApplicationSubmission" ADD CONSTRAINT "ApplicationSubmission_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationSubmission" ADD CONSTRAINT "ApplicationSubmission_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "ApplicationKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
