BEGIN;

-- Preserve every explicitly configured value. Fail rather than reinterpret a legacy ratio.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "EditorialLine"
    WHERE CASE WHEN jsonb_typeof("languageDistribution") = 'object' THEN
      CASE WHEN (SELECT count(*) FROM jsonb_object_keys("languageDistribution") AS keys) = 2
        AND jsonb_typeof("languageDistribution" -> 'pt-BR') = 'number'
        AND jsonb_typeof("languageDistribution" -> 'en-US') = 'number'
      THEN ("languageDistribution" ->> 'pt-BR')::numeric < 0
        OR ("languageDistribution" ->> 'en-US')::numeric < 0
        OR trunc(("languageDistribution" ->> 'pt-BR')::numeric) <> ("languageDistribution" ->> 'pt-BR')::numeric
        OR trunc(("languageDistribution" ->> 'en-US')::numeric) <> ("languageDistribution" ->> 'en-US')::numeric
        OR ("languageDistribution" ->> 'pt-BR')::numeric + ("languageDistribution" ->> 'en-US')::numeric <> "postsPerWeek"
      ELSE TRUE END
    ELSE TRUE END
  ) THEN
    RAISE EXCEPTION 'EditorialLine languageDistribution must be reconciled explicitly: language counts must be non-negative integers summing to postsPerWeek. No values were changed.';
  END IF;
END $$;

ALTER TABLE "EditorialLine" ALTER COLUMN "languageDistribution" SET DEFAULT '{"pt-BR":4,"en-US":0}'::jsonb;
ALTER TABLE "EditorialLine" ADD CONSTRAINT "EditorialLine_languageDistribution_count_check" CHECK (
  CASE WHEN jsonb_typeof("languageDistribution") = 'object' THEN
    CASE WHEN "languageDistribution" - 'pt-BR' - 'en-US' = '{}'::jsonb
     AND "languageDistribution" ? 'pt-BR'
     AND "languageDistribution" ? 'en-US'
     AND jsonb_typeof("languageDistribution" -> 'pt-BR') = 'number'
     AND jsonb_typeof("languageDistribution" -> 'en-US') = 'number'
    THEN ("languageDistribution" ->> 'pt-BR')::numeric >= 0
      AND ("languageDistribution" ->> 'en-US')::numeric >= 0
      AND trunc(("languageDistribution" ->> 'pt-BR')::numeric) = ("languageDistribution" ->> 'pt-BR')::numeric
      AND trunc(("languageDistribution" ->> 'en-US')::numeric) = ("languageDistribution" ->> 'en-US')::numeric
      AND ("languageDistribution" ->> 'pt-BR')::numeric + ("languageDistribution" ->> 'en-US')::numeric = "postsPerWeek"
    ELSE FALSE END
  ELSE FALSE END
);

COMMIT;
