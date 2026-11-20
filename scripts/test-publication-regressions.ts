import assert from "node:assert/strict";
import { PostStatus, QualityGateStatus } from "@prisma/client";
import { getApprovalEligibility, getPublicationEligibility } from "../src/lib/publication-eligibility";

const base = {
  status: PostStatus.APPROVED,
  qualityStatus: QualityGateStatus.PASS,
  qualityScore: 84,
  publishedAt: null,
  mediaUrl: "https://blob.example/image.png",
  qualityReview: { renderedImage: { status: "PASS", reviewedMediaUrl: "https://blob.example/image.png" } },
  currentVersionId: "version-1",
  approvedCreativeBriefId: "creative-1",
  approvedCreativeBrief: { id: "creative-1", postVersionId: "version-1", reviewStatus: QualityGateStatus.PASS, mediaUrl: "https://blob.example/image.png" },
  formatType: "SINGLE_IMAGE" as const,
};

assert.equal(getPublicationEligibility(base).eligible, true);
assert.equal(getPublicationEligibility({ ...base, qualityStatus: QualityGateStatus.NEEDS_REVISION }).eligible, false);
assert.equal(getPublicationEligibility({ ...base, status: PostStatus.DRAFT }).eligible, false);
assert.equal(getPublicationEligibility({ ...base, publishedAt: new Date() }).eligible, false);
assert.equal(getPublicationEligibility({ ...base, mediaUrl: null }).eligible, false);
assert.equal(getApprovalEligibility({ ...base, status: PostStatus.AWAITING_APPROVAL }).eligible, true, "quality review can pass before workflow approval");
const versioned = { ...base, currentVersionId: "version-1", approvedCreativeBriefId: "creative-1", approvedCreativeBrief: { id: "creative-1", postVersionId: "version-1", reviewStatus: QualityGateStatus.PASS, mediaUrl: base.mediaUrl } };
assert.equal(getPublicationEligibility(versioned).eligible, true);
assert.equal(getPublicationEligibility({ ...versioned, approvedCreativeBrief: { ...versioned.approvedCreativeBrief, postVersionId: "version-0" } }).eligible, false, "approval for an old text version cannot publish current content");

console.log(JSON.stringify({ ok: true, cases: 8, message: "posts reprovados, não aprovados, já publicados ou aprovados em versão antiga permanecem bloqueados" }));
