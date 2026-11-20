ALTER TABLE "Post"
  ADD COLUMN "language" TEXT NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN "editorialObjective" TEXT,
  ADD COLUMN "associatedProject" TEXT,
  ADD COLUMN "topic" TEXT,
  ADD COLUMN "mediaError" TEXT;
