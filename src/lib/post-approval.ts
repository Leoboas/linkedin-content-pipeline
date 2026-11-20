import { PostStatus, QualityGateStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getApprovalEligibility } from "@/lib/publication-eligibility";

export async function approvePostWithCurrentCreative(postId: string, scheduledDate: Date, actor: string): Promise<{ approved: boolean; reasons: string[] }> {
  return prisma.$transaction(async (tx) => {
    const post = await tx.post.findUnique({ where: { id: postId } });
    if (!post) return { approved: false, reasons: ["post não encontrado"] };
    if (post.status !== PostStatus.DRAFT && post.status !== PostStatus.AWAITING_APPROVAL) return { approved: false, reasons: ["post não está aguardando aprovação"] };
    const gate = getApprovalEligibility(post);
    if (!gate.eligible) return { approved: false, reasons: gate.reasons };
    if (!post.currentVersionId) return { approved: false, reasons: ["post sem versão textual persistida; gere uma revisão versionada antes de aprovar"] };

    const creative = await tx.creativeBrief.findFirst({
      where: { postId, postVersionId: post.currentVersionId },
      orderBy: [{ creativeRevision: "desc" }, { createdAt: "desc" }],
    });
    if (!creative) return { approved: false, reasons: ["não existe briefing/criativo para a versão textual atual"] };
    if (creative.reviewStatus !== QualityGateStatus.PASS) return { approved: false, reasons: ["a revisão do criativo atual não passou no quality gate"] };
    if (creative.mediaUrl !== post.mediaUrl) return { approved: false, reasons: ["a mídia atual diverge da mídia revisada"] };

    const updated = await tx.post.updateMany({
      where: { id: postId, status: { in: [PostStatus.DRAFT, PostStatus.AWAITING_APPROVAL] }, currentVersionId: post.currentVersionId, approvedCreativeBriefId: null },
      data: { status: PostStatus.APPROVED, scheduledFor: scheduledDate, scheduledDate, approvedCreativeBriefId: creative.id },
    });
    if (!updated.count) return { approved: false, reasons: ["post alterado durante a aprovação; atualize e tente novamente"] };
    await tx.postApprovalEvent.create({ data: {
      postId,
      postVersionId: post.currentVersionId,
      creativeBriefId: creative.id,
      eventType: "APPROVED",
      actor,
    } });
    return { approved: true, reasons: [] };
  });
}
