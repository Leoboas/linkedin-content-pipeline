ALTER TABLE "EditorialLine"
  ADD COLUMN "postsPerWeek" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN "languageDistribution" JSONB NOT NULL DEFAULT '{"pt-BR":4,"en-US":0}'::jsonb;
