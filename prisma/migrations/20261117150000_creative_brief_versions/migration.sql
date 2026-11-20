CREATE TABLE "CreativeBrief" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "thesis" TEXT NOT NULL,
    "technicalConflict" TEXT NOT NULL,
    "concreteProblem" TEXT NOT NULL,
    "visualConcept" TEXT NOT NULL,
    "shortOverlayTitle" TEXT,
    "evidenceSnapshot" JSONB,
    "effectivePrompt" TEXT,
    "mediaUrl" TEXT,
    "aestheticScore" INTEGER,
    "semanticScore" INTEGER,
    "technicalScore" INTEGER,
    "reviewStatus" "QualityGateStatus",
    "reviewSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreativeBrief_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreativeBrief_postId_version_key" ON "CreativeBrief"("postId", "version");
CREATE INDEX "CreativeBrief_postId_createdAt_idx" ON "CreativeBrief"("postId", "createdAt");

ALTER TABLE "CreativeBrief" ADD CONSTRAINT "CreativeBrief_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
