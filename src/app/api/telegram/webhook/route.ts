import { NextResponse } from "next/server";
import { PostStatus } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { nextValidPostingWindow } from "@/lib/scheduler";
import { recordRejectionFeedback } from "@/lib/rag";
import { requestBatchIfStockIsLow } from "@/lib/stock";
import {
  answerCallbackQuery,
  editTelegramMessage,
  postMarker,
  sendAgenda,
  sendFeedbackQueued,
  sendFeedbackPrompt,
  sendTelegramText,
} from "@/lib/telegram";

interface TelegramMessage {
  message_id?: number;
  chat?: { id?: number | string };
  text?: string;
  reply_to_message?: { message_id?: number; text?: string };
}

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
}

function isAuthorizedWebhook(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  return request.headers.get("x-telegram-bot-api-secret-token") === expected;
}

async function acknowledgeCallback(callbackId: string, text: string): Promise<void> {
  try {
    await answerCallbackQuery(callbackId, text);
  } catch (error) {
    console.error("Falha ao responder callback do Telegram:", error);
  }
}

function extractPostId(text: string | undefined): string | undefined {
  return text?.match(/post:([0-9a-f-]{36})/i)?.[1];
}

function chatIdOf(message: TelegramMessage | undefined): number | string | undefined {
  return message?.chat?.id;
}

function isCommand(text: string | undefined, command: string): boolean {
  return Boolean(text?.trim().match(new RegExp(`^\\/${command}(?:@\\w+)?(?:\\s|$)`, "i")));
}

async function handleAgendaCallback(callback: TelegramCallbackQuery, match: RegExpExecArray): Promise<NextResponse> {
  const [, action, postId] = match;
  await acknowledgeCallback(callback.id, action === "cancel" ? "Cancelando post..." : "Atualizando agenda...");
  const current = await prisma.post.findUnique({ where: { id: postId } });
  if (!current || (current.status !== PostStatus.APPROVED && current.status !== PostStatus.SCHEDULED)) {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  const chatId = chatIdOf(callback.message);
  const messageId = callback.message?.message_id;
  if (action === "cancel") {
    await prisma.post.updateMany({
      where: { id: postId, status: { in: [PostStatus.APPROVED, PostStatus.SCHEDULED] } },
      data: { status: PostStatus.CANCELLED, rejectionFeedback: "Cancelado pelo comando /agenda." },
    });
    if (chatId !== undefined && messageId !== undefined) {
      await editTelegramMessage(chatId, messageId, "<b>🚫 Post cancelado.</b>", { inline_keyboard: [] });
    }
    return NextResponse.json({ ok: true, status: PostStatus.CANCELLED });
  }

  const days = action === "delay2" ? 2 : 1;
  const currentDate = current.scheduledDate ?? current.scheduledFor;
  const scheduledDate = new Date(currentDate.getTime() + days * 24 * 60 * 60 * 1000);
  await prisma.post.updateMany({
    where: { id: postId, status: { in: [PostStatus.APPROVED, PostStatus.SCHEDULED] } },
    data: { scheduledFor: scheduledDate, scheduledDate, status: PostStatus.SCHEDULED },
  });
  if (chatId !== undefined && messageId !== undefined) {
    await editTelegramMessage(
      chatId,
      messageId,
      `<b>📅 Post reagendado +${days} dia(s).</b>\nNovo horário: ${scheduledDate.toISOString()}`,
      { inline_keyboard: [] },
    );
  }
  return NextResponse.json({ ok: true, scheduledDate });
}

async function handleMessageCommand(message: TelegramMessage): Promise<NextResponse | null> {
  const text = message.text?.trim();
  const chatId = chatIdOf(message);
  if (!text || chatId === undefined) return null;

  if (isCommand(text, "agenda")) {
    const posts = await prisma.post.findMany({
      where: { status: { in: [PostStatus.APPROVED, PostStatus.SCHEDULED] } },
      orderBy: { scheduledFor: "asc" },
      take: 5,
    });
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
  return null;
}

async function handleCallback(callback: TelegramCallbackQuery): Promise<NextResponse> {
  const agendaMatch = /^agenda:(delay1|delay2|cancel):([0-9a-f-]{36})$/i.exec(callback.data ?? "");
  if (agendaMatch) return handleAgendaCallback(callback, agendaMatch);

  // Compatibilidade com cards antigos (_) e atuais (:).
  const match = /^(approve|reject)[:_]([0-9a-f-]{36})$/.exec(callback.data ?? "");
  if (!match) {
    await acknowledgeCallback(callback.id, "Ação inválida.");
    return NextResponse.json({ ok: true });
  }

  const [, action, postId] = match;
  const isReject = action === "reject";
  await acknowledgeCallback(
    callback.id,
    isReject ? "❌ Post Recusado. Digite abaixo o que deseja alterar." : "Processando aprovação...",
  );

  const current = await prisma.post.findUnique({ where: { id: postId } });
  if (current?.status === PostStatus.REGENERATING) {
    return NextResponse.json({ ok: true, alreadyRegenerating: true });
  }
  if (current?.status === PostStatus.REJECTED_PENDING_FEEDBACK && isReject) {
    const chatId = chatIdOf(callback.message);
    const messageId = callback.message?.message_id;
    if (chatId !== undefined && messageId !== undefined) {
      try {
        await editTelegramMessage(chatId, messageId, "<b>❌ Post Recusado.</b>\n\nOs botões foram desativados.", { inline_keyboard: [] });
        await sendFeedbackPrompt(chatId, messageId, postId);
      } catch (error) {
        console.error(`Falha ao reenviar pergunta de feedback do post ${postId}:`, error);
      }
    }
    return NextResponse.json({ ok: true, feedbackPromptSent: true });
  }
  const actionableStatuses = new Set<PostStatus>([PostStatus.AWAITING_APPROVAL, PostStatus.DRAFT]);
  if (!current || !actionableStatuses.has(current.status)) {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  const existingSchedule = current.scheduledDate ?? current.scheduledFor;
  const scheduledDate = existingSchedule > new Date()
    ? existingSchedule
    : nextValidPostingWindow(new Date(), current.editorialPillar);
  const nextStatus = isReject ? PostStatus.REJECTED_PENDING_FEEDBACK : PostStatus.APPROVED;
  const updated = await prisma.post.updateMany({
    where: { id: postId, status: { in: [PostStatus.AWAITING_APPROVAL, PostStatus.DRAFT] } },
    data: {
      status: nextStatus,
      ...(!isReject ? { scheduledFor: scheduledDate, scheduledDate } : {}),
    },
  });
  if (updated.count === 0) return NextResponse.json({ ok: true, alreadyProcessed: true });

  const chatId = chatIdOf(callback.message);
  const messageId = callback.message?.message_id;
  if (chatId !== undefined && messageId !== undefined) {
    const confirmation = isReject
      ? `<b>❌ Post Recusado.</b>\n\n👇 <b>Responda a ESTA mensagem</b> com as alterações desejadas.\n\nExemplo: "Deixe o tom mais direto e troque a imagem por um estilo 3D minimalista."\n\n${postMarker(postId)}`
      : `<b>✅ Post Aprovado!</b> (Agendado para ${scheduledDate.toISOString()})`;
    try {
      await editTelegramMessage(
        chatId,
        messageId,
        confirmation,
        { inline_keyboard: [] },
      );
    } catch (error) {
      console.error(`Falha ao atualizar a mensagem do post ${postId}:`, error);
    }
    if (isReject) {
      try {
        await sendFeedbackPrompt(chatId, messageId, postId);
      } catch (error) {
        console.error(`Falha ao enviar a pergunta de feedback do post ${postId}:`, error);
      }
    }
  }
  if (isReject) {
    try {
      await requestBatchIfStockIsLow({ force: true });
    } catch (error) {
      console.error(`Falha ao solicitar reposição após recusa do post ${postId}:`, error);
    }
  }

  if (!isReject) {
    await inngest.send({ name: "posts/publish.requested", data: { postId } });
  }
  return NextResponse.json({ ok: true, status: nextStatus });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorizedWebhook(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const callback = update.callback_query;
  const message = update.message;
  const configuredChatId = process.env.TELEGRAM_CHAT_ID;
  const updateChatId = chatIdOf(callback?.message ?? message);
  if (configuredChatId && updateChatId !== undefined && String(updateChatId) !== configuredChatId) {
    return NextResponse.json({ error: "Chat não autorizado." }, { status: 403 });
  }

  if (callback?.id) {
    try {
      return await handleCallback(callback);
    } catch (error) {
      console.error("Falha ao processar callback do Telegram:", error);
      await acknowledgeCallback(callback.id, "Não foi possível processar agora.");
      return NextResponse.json({ error: "Falha ao processar a ação." }, { status: 500 });
    }
  }

  const commandResponse = message ? await handleMessageCommand(message) : null;
  if (commandResponse) return commandResponse;

  const feedback = message?.text?.trim();
  const postId = extractPostId(message?.reply_to_message?.text);
  const replyMessageId = message?.reply_to_message?.message_id;
  if (!feedback || !postId) return NextResponse.json({ ok: true });

  const existingPost = await prisma.post.findUnique({ where: { id: postId }, select: { status: true, updatedAt: true } });
  if (!existingPost) return NextResponse.json({ ok: true, postNotFound: true });

  // Permite recuperar uma execução que ficou presa após um timeout da função ou do provedor de IA.
  const regenerationExpired = existingPost.status === PostStatus.REGENERATING
    && Date.now() - existingPost.updatedAt.getTime() > 10 * 60 * 1000;
  if (regenerationExpired) {
    await prisma.post.updateMany({
      where: { id: postId, status: PostStatus.REGENERATING },
      data: { status: PostStatus.REJECTED_PENDING_FEEDBACK },
    });
  }

  // A geração de imagem pode levar mais tempo que o timeout do webhook do Telegram.
  // Enfileiramos e respondemos imediatamente; o Inngest envia o novo card ao terminar.
  const locked = await prisma.post.updateMany({
    where: { id: postId, status: PostStatus.REJECTED_PENDING_FEEDBACK },
    data: { status: PostStatus.REGENERATING, feedbackText: feedback },
  });
  if (locked.count === 0) {
    return NextResponse.json({ ok: true, alreadyQueued: true });
  }
  try {
    await recordRejectionFeedback(postId, feedback);
    await inngest.send({ name: "posts/reformulate.requested", data: { postId, feedback } });
  } catch (error) {
    await prisma.post.updateMany({
      where: { id: postId, status: PostStatus.REGENERATING },
      data: { status: PostStatus.REJECTED_PENDING_FEEDBACK },
    });
    throw error;
  }
  if (updateChatId !== undefined && replyMessageId !== undefined) {
    try {
      await sendFeedbackQueued(updateChatId, replyMessageId);
    } catch (error) {
      console.error("Falha ao confirmar recebimento do feedback:", error);
    }
  }
  return NextResponse.json({ ok: true, queued: true });
}
