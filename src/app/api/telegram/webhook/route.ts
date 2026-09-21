import { NextResponse } from "next/server";
import { PostStatus } from "@prisma/client";
import { requestPostPublication, requestPostRefactor } from "@/lib/content-engine";
import { JobDescriptionUnavailableError, matchInboundJob } from "@/lib/job-matcher";
import { auditLinkedInProfile } from "@/lib/profile-auditor";
import { prisma } from "@/lib/prisma";
import { nextValidPostingWindow } from "@/lib/scheduler";
import { formatDateInBrazil } from "@/lib/dates";
import { requestBatchIfStockIsLow } from "@/lib/stock";
import {
  answerCallbackQuery, editTelegramMessage, postMarker, sendAgenda,
  sendCareerJobAnalysis, sendFeedbackPrompt, sendFeedbackQueued, sendProfileAudit, sendTelegramText,
} from "@/lib/telegram";

interface TelegramMessage {
  message_id?: number;
  chat?: { id?: number | string };
  text?: string;
  caption?: string;
  reply_to_message?: { message_id?: number; text?: string; caption?: string };
}

interface TelegramCallbackQuery { id: string; data?: string; message?: TelegramMessage; }
interface TelegramUpdate { callback_query?: TelegramCallbackQuery; message?: TelegramMessage; }

function isAuthorizedWebhook(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  return request.headers.get("x-telegram-bot-api-secret-token") === expected;
}

async function acknowledgeCallback(callbackId: string, text: string): Promise<void> {
  try { await answerCallbackQuery(callbackId, text); } catch (error) { console.error("Falha ao responder callback do Telegram:", error); }
}

function extractPostId(text: string | undefined): string | undefined {
  return text?.match(/post:([0-9a-f-]{36})/i)?.[1];
}

function extractJobId(text: string | undefined): string | undefined {
  return text?.match(/vaga:([0-9a-f-]{36})/i)?.[1];
}

function chatIdOf(message: TelegramMessage | undefined): number | string | undefined { return message?.chat?.id; }

function isCommand(text: string | undefined, command: string): boolean {
  return Boolean(text?.trim().match(new RegExp(`^\\/${command}(?:@\\w+)?(?:\\s|$)`, "i")));
}

async function handleAgendaCallback(callback: TelegramCallbackQuery, match: RegExpExecArray): Promise<NextResponse> {
  const [, action, postId] = match;
  await acknowledgeCallback(callback.id, action === "cancel" ? "Cancelando post..." : "Atualizando agenda...");
  const current = await prisma.post.findUnique({ where: { id: postId } });
  if (!current || (current.status !== PostStatus.APPROVED && current.status !== PostStatus.SCHEDULED)) return NextResponse.json({ ok: true, alreadyProcessed: true });
  const chatId = chatIdOf(callback.message);
  const messageId = callback.message?.message_id;
  if (action === "cancel") {
    await prisma.post.updateMany({ where: { id: postId, status: { in: [PostStatus.APPROVED, PostStatus.SCHEDULED] } }, data: { status: PostStatus.CANCELLED, rejectionFeedback: "Cancelado pelo comando /agenda." } });
    if (chatId !== undefined && messageId !== undefined) await editTelegramMessage(chatId, messageId, "<b>🚫 Post cancelado.</b>", { inline_keyboard: [] });
    await requestBatchIfStockIsLow({ force: true });
    return NextResponse.json({ ok: true, status: PostStatus.CANCELLED });
  }
  const days = action === "delay2" ? 2 : 1;
  const scheduledDate = new Date((current.scheduledDate ?? current.scheduledFor).getTime() + days * 86400000);
  await prisma.post.updateMany({ where: { id: postId, status: { in: [PostStatus.APPROVED, PostStatus.SCHEDULED] } }, data: { scheduledFor: scheduledDate, scheduledDate, status: PostStatus.SCHEDULED } });
  if (chatId !== undefined && messageId !== undefined) await editTelegramMessage(chatId, messageId, `<b>📅 Post reagendado +${days} dia(s).</b>\nNovo horário (BRT): ${formatDateInBrazil(scheduledDate)}`, { inline_keyboard: [] });
  return NextResponse.json({ ok: true, scheduledDate });
}

async function handleMessageCommand(message: TelegramMessage): Promise<NextResponse | null> {
  const text = message.text?.trim();
  const chatId = chatIdOf(message);
  if (!text || chatId === undefined) return null;
  if (isCommand(text, "audit")) {
    console.log("[Telegram Webhook] Executando /audit...");
    try {
      const report = await auditLinkedInProfile();
      await sendProfileAudit(chatId, report);
      console.log("[Telegram Webhook] /audit concluido.", { score: report.score });
      return NextResponse.json({ ok: true, command: "audit", score: report.score });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error("[Telegram Webhook] /audit falhou:", error);
      await sendTelegramText(chatId, `⚠️ <b>Falha na auditoria do perfil.</b>\nCausa: ${reason.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}`);
      return NextResponse.json({ ok: false, command: "audit", error: reason }, { status: 502 });
    }
  }
  if (isCommand(text, "agenda")) {
    const posts = await prisma.post.findMany({ where: { status: { in: [PostStatus.APPROVED, PostStatus.SCHEDULED] } }, orderBy: { scheduledFor: "asc" }, take: 5 });
    await sendAgenda(posts);
    return NextResponse.json({ ok: true, command: "agenda", count: posts.length });
  }
  const reference = text.match(/^\/ref(?:@\w+)?\s+([\s\S]+)$/i)?.[1]?.trim();
  if (reference) {
    const sourceUrl = reference.match(/https?:\/\/\S+/i)?.[0] ?? null;
    const saved = await prisma.contentReference.create({ data: { content: reference, sourceUrl } });
    await sendTelegramText(chatId, `✅ Referência salva no repertório RAG.\nID: <code>${saved.id}</code>`);
    return NextResponse.json({ ok: true, command: "ref", referenceId: saved.id });
  }
  const jobUrl = text.match(/^\/vaga(?:@\w+)?\s+(https?:\/\/\S+)$/i)?.[1];
  if (jobUrl) {
    try {
      const analysis = await matchInboundJob({ url: jobUrl, body: "" });
      await sendCareerJobAnalysis(chatId, analysis);
      return NextResponse.json({ ok: true, command: "vaga", jobId: analysis.jobId, score: analysis.score });
    } catch (error) {
      if (error instanceof JobDescriptionUnavailableError) {
        await sendTelegramText(chatId, "⚠️ O LinkedIn bloqueou a leitura automática desse link. Por favor, copie todo o texto de descrição da vaga e envie aqui no chat para eu analisar.");
        return NextResponse.json({ ok: true, command: "vaga", blocked: true });
      }
      console.error("[Telegram Webhook] Falha ao analisar URL de vaga:", error);
      await sendTelegramText(chatId, "⚠️ Não consegui analisar esse link agora. Copie todo o texto da descrição da vaga e envie aqui no chat.");
      return NextResponse.json({ ok: false, command: "vaga" }, { status: 502 });
    }
  }
  return null;
}

async function handleCallback(callback: TelegramCallbackQuery): Promise<NextResponse> {
  const agendaMatch = /^agenda:(delay1|delay2|cancel):([0-9a-f-]{36})$/i.exec(callback.data ?? "");
  if (agendaMatch) return handleAgendaCallback(callback, agendaMatch);
  const match = /^(approve|reject)[:_]([0-9a-f-]{36})$/i.exec(callback.data ?? "");
  if (!match) { await acknowledgeCallback(callback.id, "Ação inválida."); return NextResponse.json({ ok: true }); }
  const [, action, postId] = match;
  const isReject = action.toLowerCase() === "reject";
  await acknowledgeCallback(callback.id, isReject ? "❌ Post recusado. Digite o que deseja alterar." : "Processando aprovação...");
  const current = await prisma.post.findUnique({ where: { id: postId } });
  if (current?.status === PostStatus.REGENERATING) return NextResponse.json({ ok: true, alreadyRegenerating: true });
  if (current?.status === PostStatus.REJECTED_PENDING_FEEDBACK && isReject) {
    const chatId = chatIdOf(callback.message);
    const messageId = callback.message?.message_id;
    if (chatId !== undefined && messageId !== undefined) await sendFeedbackPrompt(chatId, messageId, postId);
    return NextResponse.json({ ok: true, feedbackPromptSent: true });
  }
  const actionableStatuses = new Set<PostStatus>([PostStatus.AWAITING_APPROVAL, PostStatus.DRAFT]);
  if (!current || !actionableStatuses.has(current.status)) return NextResponse.json({ ok: true, alreadyProcessed: true });
  const existingSchedule = current.scheduledDate ?? current.scheduledFor;
  const scheduledDate = existingSchedule > new Date() ? existingSchedule : nextValidPostingWindow(new Date(), current.editorialPillar);
  const nextStatus = isReject ? PostStatus.REJECTED_PENDING_FEEDBACK : PostStatus.APPROVED;
  const updated = await prisma.post.updateMany({ where: { id: postId, status: { in: [PostStatus.AWAITING_APPROVAL, PostStatus.DRAFT] } }, data: { status: nextStatus, ...(!isReject ? { scheduledFor: scheduledDate, scheduledDate } : {}) } });
  if (updated.count === 0) return NextResponse.json({ ok: true, alreadyProcessed: true });
  const chatId = chatIdOf(callback.message);
  const messageId = callback.message?.message_id;
  if (chatId !== undefined && messageId !== undefined) {
    const confirmation = isReject
      ? `<b>❌ Post recusado.</b>\n\nResponda à mensagem de feedback para reformular texto e imagem.\n\n${postMarker(postId)}`
      : `<b>✅ Post aprovado!</b> Agendado para ${formatDateInBrazil(scheduledDate)} (BRT)`;
    await editTelegramMessage(chatId, messageId, confirmation, { inline_keyboard: [] });
    if (isReject) await sendFeedbackPrompt(chatId, messageId, postId);
  }
  if (isReject) await requestBatchIfStockIsLow({ force: true });
  else await requestPostPublication(postId);
  return NextResponse.json({ ok: true, status: nextStatus });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorizedWebhook(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const update = await request.json() as TelegramUpdate;
  const callback = update.callback_query;
  const message = update.message;
  const configuredChatId = process.env.TELEGRAM_CHAT_ID;
  const updateChatId = chatIdOf(callback?.message ?? message);
  if (configuredChatId && updateChatId !== undefined && String(updateChatId) !== configuredChatId) return NextResponse.json({ error: "Chat não autorizado." }, { status: 403 });
  if (callback?.id) {
    try { return await handleCallback(callback); } catch (error) {
      console.error("Falha ao processar callback do Telegram:", error);
      await acknowledgeCallback(callback.id, "Não foi possível processar agora.");
      return NextResponse.json({ error: "Falha ao processar a ação." }, { status: 500 });
    }
  }
  const commandResponse = message ? await handleMessageCommand(message) : null;
  if (commandResponse) return commandResponse;
  const feedback = message?.text?.trim();
  const reply = message?.reply_to_message;
  const jobId = extractJobId(reply?.text ?? reply?.caption);
  const replyMessageId = reply?.message_id;
  if (feedback && jobId && updateChatId !== undefined) {
    try {
      const repliedJob = await prisma.jobListing.findUnique({ where: { id: jobId } });
      if (!repliedJob) {
        await sendTelegramText(updateChatId, "⚠️ Não encontrei a vaga associada. Envie novamente a URL com /vaga ou cole a descrição completa.");
        return NextResponse.json({ ok: false, jobNotFound: true }, { status: 404 });
      }
      const analysis = await matchInboundJob({ url: repliedJob.url, subject: repliedJob.title, body: feedback });
      await sendCareerJobAnalysis(updateChatId, analysis, replyMessageId);
      return NextResponse.json({ ok: true, careerJobAnalyzed: true, jobId });
    } catch (error) {
      console.error("Falha ao analisar vaga recebida pelo Telegram:", error);
      await sendTelegramText(updateChatId, "⚠️ Não consegui analisar esta vaga. Verifique se o perfil profissional foi salvo em /career e tente novamente com a descrição completa.");
      return NextResponse.json({ error: "Falha ao analisar vaga." }, { status: 502 });
    }
  }
  if (feedback && !reply && feedback.length >= 240 && updateChatId !== undefined) {
    try {
      const analysis = await matchInboundJob({ body: feedback });
      await sendCareerJobAnalysis(updateChatId, analysis);
      return NextResponse.json({ ok: true, careerJobAnalyzed: true, jobId: analysis.jobId, manual: true });
    } catch (error) {
      console.error("[Telegram Webhook] Falha ao analisar descrição manual:", error);
      await sendTelegramText(updateChatId, error instanceof JobDescriptionUnavailableError
        ? "⚠️ Não consegui identificar uma descrição de vaga válida. Envie o texto completo, incluindo título, empresa, responsabilidades e requisitos."
        : "⚠️ Não consegui analisar esta descrição agora. Tente enviar o texto completo novamente.");
      return NextResponse.json({ error: "Falha ao analisar descrição manual." }, { status: 502 });
    }
  }
  const postId = extractPostId(reply?.text ?? reply?.caption);
  if (!feedback || !postId) return NextResponse.json({ ok: true });
  const existingPost = await prisma.post.findUnique({ where: { id: postId } });
  if (!existingPost) return NextResponse.json({ ok: true, postNotFound: true });
  try {
    const result = await requestPostRefactor(postId, feedback, { recordFeedback: true });
    if (result.alreadyQueued) return NextResponse.json({ ok: true, alreadyQueued: true });
  } catch (error) {
    console.error("Falha ao enfileirar feedback do Telegram:", error);
    if (updateChatId !== undefined) await sendTelegramText(updateChatId, "⚠️ Não consegui iniciar a reformulação. Tente responder novamente em alguns segundos.");
    return NextResponse.json({ error: "Falha ao enfileirar reformulação." }, { status: 502 });
  }
  if (updateChatId !== undefined && replyMessageId !== undefined) await sendFeedbackQueued(updateChatId, replyMessageId);
  return NextResponse.json({ ok: true, queued: true });
}
