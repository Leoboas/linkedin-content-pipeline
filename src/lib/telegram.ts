import type { Post } from "@prisma/client";

const TELEGRAM_API = "https://api.telegram.org/bot";
const pillarOrder: Record<Post["editorialPillar"], number> = { TOFU: 0, MOFU: 1, BOFU: 2 };

type ApprovalPost = Pick<Post, "id" | "title" | "textContent" | "mediaUrl" | "funnelStage" | "formatType" | "scheduledFor" | "scheduledDate" | "editorialPillar" | "engagementScore" | "engagementLabel">;

function requireTelegramConfig(): { token: string; chatId: string } {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID sao obrigatorios.");
  return { token, chatId };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function telegramRequest<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const { token } = requireTelegramConfig();
  const response = await fetch(`${TELEGRAM_API}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} falhou: ${result.description ?? response.statusText}`);
  }
  return result.result as T;
}

export function approvalKeyboard(postId: string): { inline_keyboard: Array<Array<Record<string, string>>> } {
  return {
    inline_keyboard: [[
      { text: "✅ Aprovar Post", callback_data: `approve:${postId}` },
      { text: "❌ Rejeitar Post", callback_data: `reject:${postId}` },
    ]],
  };
}

export function postMarker(postId: string): string {
  return `<code>post:${postId}</code>`;
}

export async function sendPostForApproval(post: ApprovalPost): Promise<void> {
  const { chatId } = requireTelegramConfig();
  const mediaLine = post.mediaUrl
    ? `\n\n<b>Preview:</b> <a href="${escapeHtml(post.mediaUrl)}">abrir midia</a>`
    : "";
  const projection = post.engagementScore === null ? "N/A" : `${Math.round(post.engagementScore)}/100`;
  const message = [
    "<b>Novo post aguardando aprovacao</b>",
    `<b>${escapeHtml(post.title)}</b>`,
    `Pilar: ${post.editorialPillar} · Etapa: ${post.funnelStage} · Formato: ${post.formatType}`,
    `Agendado: ${escapeHtml((post.scheduledDate ?? post.scheduledFor).toISOString())}`,
    `🔮 Projeção de Engajamento: ${projection} (${post.engagementLabel ?? "Sem projecao"})`,
    "",
    escapeHtml(post.textContent.slice(0, 3200)),
    mediaLine,
    postMarker(post.id),
  ].join("\n");

  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: false,
    reply_markup: approvalKeyboard(post.id),
  });
}

export async function sendBatchToTelegram(posts: ApprovalPost[]): Promise<void> {
  const ordered = [...posts].sort((left, right) => pillarOrder[left.editorialPillar] - pillarOrder[right.editorialPillar]);
  for (const [index, post] of ordered.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
    await sendPostForApproval(post);
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
  await telegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

export async function editTelegramMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<void> {
  await telegramRequest("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function sendFeedbackPrompt(
  chatId: number | string,
  messageId: number,
  postId: string,
): Promise<void> {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    reply_to_message_id: messageId,
    text: [
      "<b>Qual foi o motivo da recusa?</b>",
      "Responda a esta mensagem descrevendo exatamente o que deseja alterar no texto ou na imagem.",
      "Exemplo: Deixe o tom mais direto e preserve o elemento visual já aprovado.",
      postMarker(postId),
    ].join("\n\n"),
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: "Informe o motivo da recusa" },
  });
}

export async function sendFeedbackQueued(
  chatId: number | string,
  replyToMessageId: number,
): Promise<void> {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    reply_to_message_id: replyToMessageId,
    text: "✅ Feedback recebido. Estou reformulando o post e enviarei um novo card para aprovação.",
  });
}

export async function sendFeedbackRetryPrompt(postId: string): Promise<void> {
  const { chatId } = requireTelegramConfig();
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: [
      "⚠️ Não consegui concluir a reformulação deste post.",
      "Responda a esta mensagem para tentar novamente com novas instruções.",
      postMarker(postId),
    ].join("\n\n"),
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: "Tente novamente" },
  });
}
