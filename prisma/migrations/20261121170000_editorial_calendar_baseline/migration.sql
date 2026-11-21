ALTER TABLE "EditorialLine"
ADD COLUMN "weeklySchedule" JSONB NOT NULL DEFAULT '[{"weekday":1,"localTime":"13:00","language":"en-US","objective":"Discovery"},{"weekday":2,"localTime":"16:00","language":"pt-BR","objective":"Authority"},{"weekday":4,"localTime":"13:00","language":"en-US","objective":"Proof"},{"weekday":5,"localTime":"16:00","language":"pt-BR","objective":"Career Conversion"}]'::jsonb;

ALTER TABLE "EditorialLine"
ALTER COLUMN "languageDistribution" SET DEFAULT '{"pt-BR":2,"en-US":2}'::jsonb;

UPDATE "EditorialLine"
SET "postsPerWeek" = 4,
    "languageDistribution" = '{"pt-BR":2,"en-US":2}'::jsonb;
