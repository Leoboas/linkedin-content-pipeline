import { PDFDocument } from "pdf-lib";
import { Prisma, PostStatus } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { getAppUrl } from "@/lib/app-url";
import { predictEngagement } from "@/lib/analytics";
import { generateCreativeImage, generateWeeklyPosts as generateWithHuggingFace, type GeneratedSlide } from "@/lib/huggingface";
import { buildImagePrompt } from "@/lib/image-prompt-engine";
import { prisma } from "@/lib/prisma";
import { publishDuePost } from "@/lib/publishing";
import { buildRagContext } from "@/lib/rag";
import { reformulatePostFromFeedback as regeneratePostFromFeedback } from "@/lib/reformulation";
import { reconcileOverduePosts } from "@/lib/scheduler";
import { pillarOrder, scheduledDateForPost } from "@/lib/scheduling";
import { requestBatchIfStockIsLow } from "@/lib/stock";
import { uploadPublicAsset } from "@/lib/storage";
import { sendBatchToTelegram } from "@/lib/telegram";
import { sendFeedbackRetryPrompt } from "@/lib/telegram";

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
    const title = record.title;
    const bullets = record.bullets;
    if (typeof title !== "string" || !Array.isArray(bullets)) return [];
    return [
      {
        title,
        bullets: bullets.filter((bullet): bullet is string => typeof bullet === "string"),
        ...(typeof record.code === "string" ? { code: record.code } : {}),
        ...(Array.isArray(record.metrics)
          ? { metrics: record.metrics.filter((metric): metric is string => typeof metric === "string") }
          : {}),
      },
    ];
  });
}

async function renderCarouselPdf(postId: string, title: string, slides: GeneratedSlide[]): Promise<string> {
  if (slides.length === 0) throw new Error(`Post ${postId} não possui lâminas para renderizar.`);

  const pdf = await PDFDocument.create();
  const appUrl = getAppUrl();
  for (const [index, slide] of slides.entries()) {
    const png = await renderSlidePng(appUrl, postId, slide, index, slides.length);
    const image = await pdf.embedPng(png);
    const page = pdf.addPage([1080, 1350]);
    page.drawImage(image, { x: 0, y: 0, width: 1080, height: 1350 });
  }

  const bytes = await pdf.save();
  return uploadPublicAsset(`linkedin-posts/${postId}-${encodeURIComponent(title)}.pdf`, bytes, "application/pdf");
}

async function renderSlidePng(
  appUrl: string,
  postId: string,
  slide: GeneratedSlide,
  index: number,
  pageCount: number,
): Promise<ArrayBuffer> {
  const params = new URLSearchParams({
    title: slide.title,
    content: JSON.stringify(slide.bullets),
    page: String(index + 1),
    pageCount: String(pageCount),
  });
  if (slide.code) params.set("code", slide.code);
  if (slide.metrics) params.set("metrics", JSON.stringify(slide.metrics));

  const response = await fetch(`${appUrl}/api/og/slide?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Falha ao renderizar a lâmina ${index + 1} do post ${postId}: ${response.status}`);
  }
  return response.arrayBuffer();
}

async function renderSingleImage(postId: string, title: string, textContent: string, slides: GeneratedSlide[]): Promise<string> {
  const imagePrompt = buildImagePrompt({
    title,
    textContent,
    visualBullets: slides[0]?.bullets,
  });
  const imageBuffer = await generateCreativeImage(imagePrompt);
  return uploadPublicAsset(`linkedin-posts/${postId}-${encodeURIComponent(title)}.png`, imageBuffer, "image/png");
}

export const weeklyPostPipeline = inngest.createFunction(
  {
    id: "generate-weekly-linkedin-posts",
    retries: 3,
  },
  [{ event: "posts/generate.weekly" }, { event: "pipeline/generate-batch" }],
  async ({ event, step }) => {
    await step.run("reconcile-overdue-posts", async () => reconcileOverduePosts());
    const postIds = await step.run("generate-content", async () => {
      const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" } });
      if (!editorialLine) {
        throw new Error("Nenhuma EditorialLine cadastrada para orientar a geração.");
      }

      const eventData = event.data as WeeklyEventData;
      const baseDate = eventData.triggeredAt ? new Date(eventData.triggeredAt) : new Date();
      if (Number.isNaN(baseDate.getTime())) throw new Error("triggeredAt inválido.");
      const ragContext = await buildRagContext(editorialLine.id);
      const generated = await generateWithHuggingFace({
        themes: editorialLine.themes,
        toneOfVoice: editorialLine.toneOfVoice,
        aidaRules: editorialLine.aidaRules,
        cvCases: editorialLine.cvCases,
        language: editorialLine.language,
      }, { ragSystemPrompt: ragContext.systemPrompt });
      const weekKey = baseDate.toISOString().slice(0, 10);
      const batchKey = eventData.batchKey ?? `weekly:${weekKey}`;
      const ids: string[] = [];

      const orderedGenerated = [...generated].sort((left, right) => pillarOrder(left.editorialPillar) - pillarOrder(right.editorialPillar));
      for (const [index, post] of orderedGenerated.entries()) {
        const generationKey = `${batchKey}:${index}`;
        const existing = await prisma.post.findUnique({ where: { generationKey } });
        if (existing) {
          ids.push(existing.id);
          continue;
        }

        const prediction = predictEngagement({
          title: post.title,
          textContent: post.textContent,
          editorialPillar: post.editorialPillar,
          dossier: ragContext.dossier,
          ragExamples: ragContext.examples,
        });
        const saved = await prisma.post.create({
          data: {
            generationKey,
            editorialLineId: editorialLine.id,
            editorialPillar: post.editorialPillar,
            funnelStage: post.funnelStage,
            formatType: post.formatType,
            title: post.title,
            textContent: post.textContent,
            slidesJson: post.slides as unknown as Prisma.InputJsonValue,
            engagementScore: prediction.score,
            engagementLabel: prediction.label,
            status: PostStatus.AWAITING_APPROVAL,
            scheduledFor: scheduledDateForPost(index, post.editorialPillar, baseDate),
            scheduledDate: scheduledDateForPost(index, post.editorialPillar, baseDate),
          },
        });
        ids.push(saved.id);
      }
      return ids;
    });

    const renderedPostIds = await step.run("render-visual-assets", async () => {
      const posts = await prisma.post.findMany({ where: { id: { in: postIds } } });
      for (const post of posts) {
        if (post.mediaUrl || post.formatType === "TEXT_ONLY") continue;
        try {
          const slides = slidesFromJson(post.slidesJson);
          const mediaUrl = post.formatType === "CAROUSEL_PDF"
            ? await renderCarouselPdf(post.id, post.title, slides)
            : await renderSingleImage(post.id, post.title, post.textContent, slides);
          await prisma.post.update({ where: { id: post.id }, data: { mediaUrl } });
        } catch (error) {
          throw new Error(`Renderização do post ${post.id} falhou.`, { cause: error });
        }
      }
      return posts.map((post) => post.id);
    });

    await step.run("send-telegram-approval", async () => {
      const posts = (await prisma.post.findMany({ where: { id: { in: renderedPostIds } } })).sort((left, right) => {
        const order = { TOFU: 0, MOFU: 1, BOFU: 2 } as const;
        return order[left.editorialPillar] - order[right.editorialPillar];
      });
      for (const [index, post] of posts.entries()) {
        if (post.status !== PostStatus.AWAITING_APPROVAL) continue;
        try {
          if (index > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
          await sendBatchToTelegram([post]);
        } catch (error) {
          throw new Error(`Envio para aprovação do post ${post.id} falhou.`, { cause: error });
        }
      }
      return { sent: posts.length };
    });

    return { postIds };
  },
);

export const publishApprovedPost = inngest.createFunction(
  {
    id: "publish-approved-linkedin-post",
    retries: 3,
  },
  { event: "posts/publish.requested" },
  async ({ event, step }) => {
    const post = await step.run("load-approved-post", async () => {
      const data = event.data as PublishEventData;
      if (!data.postId) throw new Error("Evento de publicação sem postId.");
      return prisma.post.findUnique({ where: { id: data.postId } });
    });

    if (!post || (post.status !== PostStatus.APPROVED && post.status !== PostStatus.SCHEDULED)) {
      return { skipped: true, reason: "post-not-approved" };
    }

    const scheduledFor = new Date(post.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) {
      throw new Error(`scheduledFor inválido para o post ${post.id}.`);
    }
    if (scheduledFor > new Date()) {
      await prisma.post.updateMany({
        where: { id: post.id, status: PostStatus.APPROVED },
        data: { status: PostStatus.SCHEDULED },
      });
      await step.sleepUntil("wait-until-scheduled", scheduledFor);
    }

    const published = await step.run("publish-to-linkedin", async () => {
      return publishDuePost(post.id);
    });

    await step.run("check-approved-stock", async () => {
      return requestBatchIfStockIsLow();
    });

    return published;
  },
);

export const reformulatePostWithFeedback = inngest.createFunction(
  {
    id: "reformulate-linkedin-post-from-telegram-feedback",
    retries: 3,
  },
  { event: "posts/reformulate.requested" },
  async ({ event, step }) => {
    const data = event.data as ReformulateEventData;
    if (!data.postId) throw new Error("Evento de feedback sem postId.");
    return step.run("regenerate-content-and-image", async () => {
      const post = await prisma.post.findUnique({ where: { id: data.postId }, select: { feedbackText: true } });
      const feedback = data.feedback?.trim() || post?.feedbackText?.trim();
      if (!feedback) throw new Error("Evento de feedback incompleto.");
      try {
        await regeneratePostFromFeedback(data.postId, feedback);
        return { postId: data.postId, status: PostStatus.DRAFT };
      } catch (error) {
        await prisma.post.updateMany({
          where: { id: data.postId, status: PostStatus.REGENERATING },
          data: { status: PostStatus.REJECTED_PENDING_FEEDBACK },
        });
        try {
          await sendFeedbackRetryPrompt(data.postId);
        } catch (notificationError) {
          console.error("Falha ao enviar prompt de retry do feedback:", notificationError);
        }
        console.error(`Reformulacao do post ${data.postId} falhou:`, error);
        return { postId: data.postId, status: PostStatus.REJECTED_PENDING_FEEDBACK, failed: true };
      }
    });
  },
);
