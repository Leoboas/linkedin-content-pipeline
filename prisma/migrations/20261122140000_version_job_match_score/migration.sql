ALTER TABLE "JobMatch"
  ADD COLUMN "scoreVersion" TEXT NOT NULL DEFAULT 'career-match-v2',
  ADD COLUMN "scoreBreakdown" JSONB NOT NULL DEFAULT '{}'::jsonb;
