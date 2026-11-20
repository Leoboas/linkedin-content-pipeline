CREATE TABLE "PostVersion" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "textContent" TEXT NOT NULL,
    "slidesJson" JSONB,
    "imagePrompt" TEXT,
    "mediaUrl" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PostVersion_postId_createdAt_idx" ON "PostVersion"("postId", "createdAt");

ALTER TABLE "PostVersion"
ADD CONSTRAINT "PostVersion_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
