-- Align names created by the original additive migration with Prisma's current datamodel.
-- This is metadata-only: no rows or relationships are changed.
ALTER TABLE "CreativeBriefEvidence" RENAME CONSTRAINT "CreativeBriefEvidence_brief_fkey" TO "CreativeBriefEvidence_creativeBriefId_fkey";
ALTER TABLE "CreativeBriefEvidence" RENAME CONSTRAINT "CreativeBriefEvidence_document_fkey" TO "CreativeBriefEvidence_knowledgeDocumentId_fkey";
ALTER TABLE "CreativeBriefEvidence" RENAME CONSTRAINT "CreativeBriefEvidence_experience_fkey" TO "CreativeBriefEvidence_experienceId_fkey";
ALTER TABLE "CreativeBriefEvidence" RENAME CONSTRAINT "CreativeBriefEvidence_fact_fkey" TO "CreativeBriefEvidence_factId_fkey";
ALTER TABLE "CreativeBriefEvidence" RENAME CONSTRAINT "CreativeBriefEvidence_project_fkey" TO "CreativeBriefEvidence_projectId_fkey";
ALTER TABLE "CreativeBriefEvidence" RENAME CONSTRAINT "CreativeBriefEvidence_source_fkey" TO "CreativeBriefEvidence_sourceId_fkey";

ALTER INDEX "CreativeBriefEvidence_brief_evidenceKey_key" RENAME TO "CreativeBriefEvidence_creativeBriefId_evidenceKey_key";
ALTER INDEX "CreativeBriefMedia_brief_role_position_key" RENAME TO "CreativeBriefMedia_creativeBriefId_role_position_key";
ALTER INDEX "PostApprovalEvent_version_brief_idx" RENAME TO "PostApprovalEvent_postVersionId_creativeBriefId_idx";
