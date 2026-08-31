import { PDFDocument } from "pdf-lib";
import { Prisma, PostStatus } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { getAppUrl } from "@/lib/app-url";
import { generateNewPostBatch, refactorPostWithFeedback } from "@/lib/content-engine";
import { generateSingleImageAsset } from "@/lib/creative-renderer";
import type { GeneratedSlide } from "@/lib/huggingface";
import { buildImagePrompt } from "@/lib/image-prompt-engine";
import { prisma } from "@/lib/prisma";
import { publishDuePost } from "@/lib/publishing";
import { reconcileOverduePosts } from "@/lib/scheduler";
import { pillarOrder } from "@/lib/scheduling";
import { requestBatchIfStockIsLow } from "@/lib/stock";
import { uploadPublicAsset } from "@/lib/storage";
import { sendBatchToTelegram, sendFeedbackRetryPrompt, sendPostForApproval } from "@/lib/telegram";

interface WeeklyEventData {
  triggeredAt?: string;
  batchKey?: string;
}

interface PublishEventData {
  postId: string;
}

interface ReformulateEventData {
  postId: string;
  feedback?: string;
}

function slidesFromJson(value: Prisma.JsonValue | null): GeneratedSlide[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): GeneratedSlide[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, Prisma.JsonValue>;
    if (typeof record.title !== "string" || !Array.isArray(record.bullets)) return [];
    return [{
      title: record.title,
      bullets: record.bullets.filter((bullet): bullet is string => typeof bullet === "string"),
      ...(typeof record.code === "string" ? { code: record.code } : {}),
      ...(Array.isArray(record.metrics) ? { metrics: record.metrics.filter((metric): metric is string => typeof metric === "string") } : {}),
    }];
  });
}

async function renderCarouselPdf(postId: string, title: string, slides: GeneratedSlide[]): Promise<string> {
  if (slides.length === 0) throw new Error(`Post ${postId} não possui lâminas para renderizar.`);
  const pdf = await PDFDocument.create();
  const appUrl = getAppUrl();
  for (const [index, slide] of slides.entries()) {
    const params = new URLSearchParams({ title: slide.title, content: JSON.stringify(slide.bullets), page: String(index + 1), pageCount: String(slides.length) });
    if (slide.code) params.set("code", slide.code);
    if (slide.metrics) params.set("metrics", JSON.stringify(slide.metrics));
    const response = await fetch(`${appUrl}/api/og/slide?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Falha ao renderizar lâmina ${index + 1} do post ${postId}: ${response.status}`);
    const image = await pdf.embedPng(await response.arrayBuffer());
    const page = pdf.addPage([1080, 1350]);
    page.drawImage(image, { x: 0, y: 0, width: 1080, height: 1350 });
  }
  return uploadPublicAsset(`linkedin-posts/${postId}-${encodeURIComponent(title)}.pdf`, await pdf.save(), "application/pdf");
}

async function renderSingleImage(postId: string, title: string, textContent: string, slides: GeneratedSlide[], storedPrompt?: string | null, editorialPillar?: string): Promise<string> {
  const imagePrompt = storedPrompt ?? buildImagePrompt({ title, textContent, visualBullets: slides[0]?.bullets });
  return generateSingleImageAsset({ postId, title, editorialPillar, imagePrompt });
}

export const weeklyPostPipeline = inngest.createFunction(
  { id: "generate-weekly-linkedin-posts", retries: 3 },
  [{ event: "posts/generate.weekly" }, { event: "pipeline/generate-batch" }],
  async ({ event, step }) => {
    await step.run("reconcile-overdue-posts", async () => reconcileOverduePosts());
    const postIds = await step.run("generate-content", async () => generateNewPostBatch(event.data as WeeklyEventData));

    const renderedPostIds = await step.run("render-visual-assets", async () => {
      const posts = await prisma.post.findMany({ where: { id: { in: postIds } } });
      for (const post of posts) {
        if (post.mediaUrl || post.formatType === "TEXT_ONLY") continue;
        const slides = slidesFromJson(post.slidesJson);
        const mediaUrl = post.formatType === "CAROUSEL_PDF"
          ? await renderCarouselPdf(post.id, post.title, slides)
          : await renderSingleImage(post.id, post.title, post.textContent, slides, post.imagePrompt, post.editorialPillar);
        await prisma.post.update({ where: { id: post.id }, data: { mediaUrl } });
      }
      return posts.map((post) => post.id);
    });

    await step.run("send-telegram-approval", async () => {
      const posts = (await prisma.post.findMany({ where: { id: { in: renderedPostIds } } })).sort((left, right) => pillarOrder(left.editorialPillar) - pillarOrder(right.editorialPillar));
      for (const [index, post] of posts.entries()) {
        if (post.status !== PostStatus.AWAITING_APPROVAL) continue;
        if (index > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
        await sendBatchToTelegram([post]);
      }
      return { sent: posts.length };
    });
    return { postIds };
  },
);

export const publishApprovedPost = inngest.createFunction(
  { id: "publish-approved-linkedin-post", retries: 3 },
  { event: "posts/publish.requested" },
  async ({ event, step }) => {
    const post = await step.run("load-approved-post", async () => {
      const data = event.data as PublishEventData;
      if (!data.postId) throw new Error("Evento de publicação sem postId.");
      return prisma.post.findUnique({ where: { id: data.postId } });
    });
    if (!post || (post.status !== PostStatus.APPROVED && post.status !== PostStatus.SCHEDULED)) return { skipped: true, reason: "post-not-approved" };
    const scheduledFor = new Date(post.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) throw new Error(`scheduledFor inválido para o post ${post.id}.`);
    if (scheduledFor > new Date()) {
      await prisma.post.updateMany({ where: { id: post.id, status: PostStatus.APPROVED }, data: { status: PostStatus.SCHEDULED } });
      await step.sleepUntil("wait-until-scheduled", scheduledFor);
    }
    const published = await step.run("publish-to-linkedin", async () => publishDuePost(post.id));
    await step.run("check-approved-stock", async () => requestBatchIfStockIsLow());
    return published;
  },
);

export const reformulatePostWithFeedback = inngest.createFunction(
  { id: "reformulate-linkedin-post-from-telegram-feedback", retries: 3 },
  { event: "posts/reformulate.requested" },
  async ({ event, step }) => {
    const data = event.data as ReformulateEventData;
    if (!data.postId) throw new Error("Evento de feedback sem postId.");
    const post = await prisma.post.findUnique({ where: { id: data.postId }, select: { feedbackText: true } });
    const feedback = data.feedback?.trim() || post?.feedbackText?.trim();
    if (!feedback) throw new Error("Evento de feedback incompleto.");
    try {
      await step.run("regenerate-content-and-image", async () => {
        await refactorPostWithFeedback(data.postId, feedback, { sendTelegram: false });
        return { postId: data.postId, status: PostStatus.DRAFT };
      });
      await step.run("send-regenerated-approval-card", async () => {
        const regenerated = await prisma.post.findUnique({ where: { id: data.postId } });
        if (!regenerated || regenerated.status !== PostStatus.DRAFT) throw new Error("Rascunho reformulado não encontrado para envio.");
        await sendPostForApproval(regenerated);
        return { postId: data.postId, sent: true };
      });
      return { postId: data.postId, status: PostStatus.DRAFT, sent: true };
    } catch (error) {
      await prisma.post.updateMany({ where: { id: data.postId, status: { in: [PostStatus.REGENERATING, PostStatus.DRAFT] } }, data: { status: PostStatus.REJECTED_PENDING_FEEDBACK } });
      try { await sendFeedbackRetryPrompt(data.postId); } catch (notificationError) { console.error("Falha ao enviar retry do feedback:", notificationError); }
      console.error(`Reformulação do post ${data.postId} falhou:`, error);
      return { postId: data.postId, status: PostStatus.REJECTED_PENDING_FEEDBACK, failed: true };
    }
  },
);
