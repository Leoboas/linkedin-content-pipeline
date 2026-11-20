-- Operational ledger for all LinkedIn REST/upload requests. Contains no tokens or payloads.
CREATE TABLE "LinkedInApiCall" (
  "id" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "statusCode" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LinkedInApiCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LinkedInApiCall_createdAt_idx" ON "LinkedInApiCall"("createdAt");
CREATE INDEX "LinkedInApiCall_operation_createdAt_idx" ON "LinkedInApiCall"("operation", "createdAt");
