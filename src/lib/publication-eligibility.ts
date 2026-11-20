import { PostStatus, QualityGateStatus, type Post } from "@prisma/client";

export interface PublicationEligibility {
  eligible: boolean;
  reasons: string[];
}

export interface PublicationCandidate {
  status: PostStatus;
  qualityStatus: QualityGateStatus | null;
  qualityScore: number | null;
  publishedAt: Date | string | null;
  mediaUrl: string | null;
  formatType: Post["formatType"];
  qualityReview?: unknown;
  currentVersionId?: string | null;
  approvedCreativeBriefId?: string | null;
  approvedCreativeBrief?: { id: string; postVersionId: string | null; reviewStatus: QualityGateStatus | null; mediaUrl: string | null } | null;
}

function visualReviewMatchesMedia(review: unknown, mediaUrl: string | null): boolean {
  if (!mediaUrl || !review || typeof review !== "object" || Array.isArray(review)) return false;
  const rendered = (review as Record<string, unknown>).renderedImage;
  if (!rendered || typeof rendered !== "object" || Array.isArray(rendered)) return false;
  const snapshot = rendered as Record<string, unknown>;
  return snapshot.status === "PASS" && snapshot.reviewedMediaUrl === mediaUrl;
}

/** Single source of truth for every approval and publication path. */
export function getPublicationEligibility(
  post: PublicationCandidate,
): PublicationEligibility {
  const reasons: string[] = [];
  if (post.publishedAt !== null || post.status === PostStatus.PUBLISHED) reasons.push("post já publicado");
  if (post.status !== PostStatus.APPROVED && post.status !== PostStatus.SCHEDULED) reasons.push("aprovação humana ausente");
  reasons.push(...getQualityReasons(post));
  if (!post.currentVersionId) reasons.push("versão textual persistida ausente; histórico legado requer nova revisão versionada");
  else {
    const creative = post.approvedCreativeBrief;
    if (!post.approvedCreativeBriefId || !creative || creative.id !== post.approvedCreativeBriefId) reasons.push("approval is not bound to a creative version");
    else {
      if (creative.postVersionId !== post.currentVersionId) reasons.push("approved text version is stale");
      if (creative.reviewStatus !== QualityGateStatus.PASS) reasons.push("approved creative does not have a passing review");
      if (creative.mediaUrl !== post.mediaUrl) reasons.push("approved creative media was replaced");
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

/** Validates editorial quality before an AWAITING_APPROVAL post changes workflow state. */
export function getApprovalEligibility(post: PublicationCandidate): PublicationEligibility {
  if (post.status === PostStatus.PUBLISHED || post.publishedAt !== null) return { eligible: false, reasons: ["post já publicado"] };
  const reasons = getQualityReasons(post);
  if (!post.currentVersionId) reasons.push("versão textual persistida ausente; registre uma revisão antes de aprovar");
  if (post.status !== PostStatus.DRAFT && post.status !== PostStatus.AWAITING_APPROVAL) reasons.push("post não está aguardando aprovação");
  return { eligible: reasons.length === 0, reasons };
}

function getQualityReasons(post: PublicationCandidate): string[] {
  const reasons: string[] = [];
  if (post.qualityStatus !== QualityGateStatus.PASS) reasons.push(`quality gate ${post.qualityStatus ?? "PENDENTE"}`);
  if (post.qualityScore === null || post.qualityScore < 72) reasons.push("quality score abaixo do mínimo");
  if (post.formatType !== "TEXT_ONLY" && !post.mediaUrl) reasons.push("mídia obrigatória ausente");
  if (post.formatType !== "TEXT_ONLY" && !visualReviewMatchesMedia(post.qualityReview, post.mediaUrl)) reasons.push("current media has no passing visual review");
  return reasons;
}

export function assertPublicationEligibility(post: PublicationCandidate): void {
  const result = getPublicationEligibility(post);
  if (!result.eligible) throw new Error(`Post não elegível para publicação: ${result.reasons.join("; ")}.`);
}
