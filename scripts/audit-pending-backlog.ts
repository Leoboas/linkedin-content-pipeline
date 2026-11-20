import { PrismaClient, PostStatus, type EditorialPillar } from "@prisma/client";
import { contentQualityIssues, type QualitySlide } from "../src/lib/content-quality";
import { validateContentClaims } from "../src/lib/claim-validator";
import { getPublicationEligibility } from "../src/lib/publication-eligibility";

const prisma = new PrismaClient();
const archivedStatuses = new Set<PostStatus>([PostStatus.CANCELLED, PostStatus.ARCHIVED, PostStatus.REJECTED]);

function slides(value: unknown): QualitySlide[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): QualitySlide[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    return typeof row.title === "string" && Array.isArray(row.bullets)
      ? [{ title: row.title, bullets: row.bullets.filter((v): v is string => typeof v === "string") }]
      : [];
  });
}

function recommendation(post: { status: PostStatus; qualityStatus: string | null; qualityScore: number | null; mediaUrl: string | null }, issues: string[], claimsBlocked: boolean): string {
  if (archivedStatuses.has(post.status)) return "manter no arquivo; não regenerar automaticamente";
  if (claimsBlocked || post.qualityStatus === "BLOCKED") return "retirar da fila publicável e regenerar com evidências";
  if (post.qualityStatus === "NEEDS_REVISION" || issues.length > 0 || (post.qualityScore ?? 0) < 72) return "revisar/regenerar";
  if (post.status === PostStatus.DRAFT) return "manter como rascunho, sem aprovação";
  if (!post.mediaUrl) return "revisar mídia";
  return "manter para aprovação humana";
}

function detectLanguage(text: string): "pt-BR" | "en-US" | "uncertain" {
  const normalized = ` ${text.toLocaleLowerCase("en-US").normalize("NFD").replace(/[\u0300-\u036f]/gu, "")} `;
  const pt = (normalized.match(/\b(nao|voce|dados|para|com|uma|que|quando|sobre|tambem|engenharia|decisao|sao|esta|como)\b/gu) ?? []).length;
  const en = (normalized.match(/\b(the|and|with|when|data|engineering|decision|your|from|this|that|how|without|because|are|is)\b/gu) ?? []).length;
  if (pt >= en + 2) return "pt-BR";
  if (en >= pt + 2) return "en-US";
  return "uncertain";
}

function normalizedTitle(title: string): string {
  return title.toLocaleLowerCase("en-US").normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, " ").trim();
}

async function main(): Promise<void> {
  const creativeBriefTable = await prisma.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public."CreativeBrief"')::text AS name`;
  const creativeBriefTableAvailable = Boolean(creativeBriefTable[0]?.name);
  const posts = await prisma.post.findMany({
    where: { status: { not: PostStatus.PUBLISHED } },
    orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, title: true, textContent: true, editorialPillar: true, status: true,
      formatType: true, mediaUrl: true, qualityScore: true, qualityStatus: true,
      qualityReview: true,
      slidesJson: true, scheduledDate: true, scheduledFor: true, editorialLineId: true, publishedAt: true,
      language: true, associatedProject: true, createdAt: true, updatedAt: true,
      _count: { select: { versions: true } },
    },
  });
  const creativePostIds = creativeBriefTableAvailable
    ? new Set((await prisma.creativeBrief.findMany({ distinct: ["postId"], select: { postId: true } })).map((row) => row.postId))
    : new Set<string>();
  const titleCounts = posts.filter((post) => !archivedStatuses.has(post.status)).reduce<Record<string, number>>((acc, post) => {
    const key = normalizedTitle(post.title);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const report = [];
  for (const post of posts) {
    const visualSlides = slides(post.slidesJson);
    const issues = contentQualityIssues({
      title: post.title,
      textContent: post.textContent,
      editorialPillar: post.editorialPillar as EditorialPillar,
      slides: visualSlides,
    });
    const claims = await validateContentClaims({ title: post.title, textContent: post.textContent, editorialLineId: post.editorialLineId ?? undefined });
    const eligibility = getPublicationEligibility(post);
    report.push({
      id: post.id,
      title: post.title,
      pillar: post.editorialPillar,
      status: post.status,
      language: post.language,
      quality: { score: post.qualityScore, status: post.qualityStatus },
      scheduledFor: (post.scheduledDate ?? post.scheduledFor).toISOString(),
      format: post.formatType,
      media: Boolean(post.mediaUrl),
      issues: [...new Set([...issues, ...claims.unsupportedClaims.map((claim) => "claim sem evidência: " + claim)])],
      eligibleNow: eligibility.eligible,
      eligibilityReasons: eligibility.reasons,
      recommendation: recommendation(post, issues, claims.blocked),
      detectedLanguage: detectLanguage(`${post.title}\n${post.textContent}`),
      languageMatchesMetadata: detectLanguage(`${post.title}\n${post.textContent}`) === post.language,
      duplicateActiveTitle: titleCounts[normalizedTitle(post.title)] > 1,
      associatedProject: post.associatedProject,
      hasVersionHistory: post._count.versions > 0,
      hasCreativeBrief: creativePostIds.has(post.id),
      updatedAfterCreation: post.updatedAt.getTime() > post.createdAt.getTime() + 60_000,
      visualReviewStatus: post.qualityReview && typeof post.qualityReview === "object" && !Array.isArray(post.qualityReview)
        ? ((post.qualityReview as Record<string, unknown>).renderedImage as Record<string, unknown> | undefined)?.status ?? null
        : null,
    });
  }
  const actionable = report.filter((post) => !archivedStatuses.has(post.status));
  const summary = {
    generatedAt: new Date().toISOString(),
    totalUnpublished: report.length,
    creativeBriefTableAvailable,
    archivedOrCancelled: report.length - actionable.length,
    actionable: actionable.length,
    byStatus: report.reduce<Record<string, number>>((acc, post) => { acc[post.status] = (acc[post.status] ?? 0) + 1; return acc; }, {}),
    actionableLanguageMismatch: actionable.filter((post) => !post.languageMatchesMetadata).length,
    actionableDuplicateTitles: actionable.filter((post) => post.duplicateActiveTitle).length,
    actionableWithoutCreativeBrief: actionable.filter((post) => !post.hasCreativeBrief).length,
    actionableWithoutMedia: actionable.filter((post) => post.format !== "TEXT_ONLY" && !post.media).length,
    actionableNeedsHumanVisualReview: actionable.filter((post) => post.visualReviewStatus === "PENDING_HUMAN_REVIEW" || post.visualReviewStatus === null && post.format !== "TEXT_ONLY").length,
    activePosts: actionable.map(({ id, title, pillar, status, quality, scheduledFor, format, media, issues, recommendation: nextAction, detectedLanguage, language, languageMatchesMetadata, duplicateActiveTitle, associatedProject, hasVersionHistory, hasCreativeBrief, updatedAfterCreation, visualReviewStatus }) => ({
      id, title, pillar, status, quality, scheduledFor, format, media, issues, recommendation: nextAction,
      language, detectedLanguage, languageMatchesMetadata, duplicateActiveTitle, associatedProject,
      hasVersionHistory, hasCreativeBrief, updatedAfterCreation, visualReviewStatus,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().finally(() => prisma.$disconnect());
