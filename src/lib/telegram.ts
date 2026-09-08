import type { Post } from "@prisma/client";
import { formatDateInBrazil } from "@/lib/dates";

const TELEGRAM_API = "https://api.telegram.org/bot";
const pillarOrder: Record<Post["editorialPillar"], number> = { TOFU: 0, MOFU: 1, BOFU: 2 };

export type ApprovalPost = Pick<Post, "id" | "title" | "textContent" | "mediaUrl" | "funnelStage" | "formatType" | "scheduledFor" | "scheduledDate" | "editorialPillar" | "engagementScore" | "engagementLabel" | "status">;

function requireTelegramConfig(): { token: string; chatId: string } {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID sao obrigatorios.");
  return { token, chatId };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
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
  if (post.mediaUrl) {
    if (post.mediaUrl.toLowerCase().includes(".pdf")) {
      await telegramRequest("sendDocument", {
        chat_id: chatId,
        document: post.mediaUrl,
        caption: `<b>Preview do carrossel</b>\n${escapeHtml(post.title)}`,
        parse_mode: "HTML",
      });
    } else {
      await telegramRequest("sendPhoto", {
        chat_id: chatId,
        photo: post.mediaUrl,
        caption: `<b>Preview visual</b>\n${escapeHtml(post.title)}`,
        parse_mode: "HTML",
      });
    }
  }
  const mediaLine = post.mediaUrl
    ? `\n\n<b>Preview:</b> <a href="${escapeHtml(post.mediaUrl)}">abrir midia</a>`
    : "";
  const projection = post.engagementScore === null ? "N/A" : `${Math.round(post.engagementScore)}/100`;
  const message = [
    "<b>Novo post aguardando aprovacao</b>",
    `<b>${escapeHtml(post.title)}</b>`,
    `Pilar: ${post.editorialPillar} · Etapa: ${post.funnelStage} · Formato: ${post.formatType}`,
    `Agendado (BRT): ${escapeHtml(formatDateInBrazil(post.scheduledDate ?? post.scheduledFor))}`,
    `🔮 Projeção de Engajamento: ${projection} (${post.engagementLabel ?? "Sem projecao"})`,
    "",
    escapeHtml(post.textContent.slice(0, 3200)),
    mediaLine,
    postMarker(post.id),
  ].join("\n");

  const sent = await telegramRequest<{ message_id?: number }>("sendMessage", {
    chat_id: chatId,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: false,
    reply_markup: approvalKeyboard(post.id),
  });
  console.info("[telegram] approval card sent", { postId: post.id, messageId: sent?.message_id });
}

function agendaKeyboard(postId: string): { inline_keyboard: Array<Array<Record<string, string>>> } {
  return {
    inline_keyboard: [[
      { text: "Adiar +1 dia", callback_data: `agenda:delay1:${postId}` },
      { text: "Adiar +2 dias", callback_data: `agenda:delay2:${postId}` },
      { text: "Cancelar Post", callback_data: `agenda:cancel:${postId}` },
    ]],
  };
}

export async function sendBatchToTelegram(posts: ApprovalPost[]): Promise<void> {
  const ordered = [...posts].sort((left, right) => pillarOrder[left.editorialPillar] - pillarOrder[right.editorialPillar]);
  for (const [index, post] of ordered.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
    await sendPostForApproval(post);
  }
}

export async function sendAgenda(posts: ApprovalPost[]): Promise<void> {
  const { chatId } = requireTelegramConfig();
  if (posts.length === 0) {
    await telegramRequest("sendMessage", { chat_id: chatId, text: "📅 Nenhum post aprovado ou agendado encontrado." });
    return;
  }
  for (const [index, post] of posts.entries()) {
    const scheduled = formatDateInBrazil(post.scheduledDate ?? post.scheduledFor);
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: [
        `<b>${index + 1}. ${escapeHtml(post.title)}</b>`,
        `Pilar: ${post.editorialPillar} · Status: ${post.status ?? "AGENDADO"}`,
        `Programado: ${escapeHtml(scheduled)} (BRT)`,
        `🔮 Engajamento: ${post.engagementScore === null ? "N/A" : `${Math.round(post.engagementScore)}/100`} (${post.engagementLabel ?? "sem projeção"})`,
        postMarker(post.id),
      ].join("\n"),
      parse_mode: "HTML",
      reply_markup: agendaKeyboard(post.id),
    });
    if (index < posts.length - 1) await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function sendTelegramText(chatId: number | string, text: string): Promise<void> {
  await telegramRequest("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

export async function sendProfileAudit(chatId: number | string, report: {
  score: number;
  suggestedHeadlines: string[];
  seoKeywords: string[];
  aboutRewrite: string;
  recommendations: string[];
  strengths: string[];
  jobHistoryCount: number;
  gaps?: string[];
  recruiterVerdict?: string;
  marketPositioning?: string;
  roleFit?: Array<{ role: string; fitScore: number; reason: string }>;
}): Promise<void> {
  const lines = [
    "<b>Auditoria do perfil LinkedIn</b>",
    `Nota geral: <b>${Math.round(report.score)}/100</b>`,
    `Histórico de vagas analisadas: ${report.jobHistoryCount}`,
    ...(report.recruiterVerdict ? ["", `<b>Veredito de recrutadora/ATS</b>\n${escapeHtml(report.recruiterVerdict)}`] : []),
    ...(report.marketPositioning ? [`<b>Posicionamento de mercado</b>\n${escapeHtml(report.marketPositioning)}`] : []),
    ...(report.roleFit?.length ? ["", "<b>Aderência por cargo-alvo</b>", ...report.roleFit.slice(0, 6).map((item) => `• ${escapeHtml(item.role)}: ${Math.round(item.fitScore)}/100 — ${escapeHtml(item.reason)}`)] : []),
    ...(report.gaps?.length ? ["", `<b>Gaps de mercado</b>\n${escapeHtml(report.gaps.join(", "))}`] : []),
    "",
    "<b>Headlines sugeridas</b>",
    ...report.suggestedHeadlines.map((item) => `• ${escapeHtml(item)}`),
    "",
    `<b>Palavras-chave SEO</b>\n${escapeHtml(report.seoKeywords.join(", ") || "Nenhuma identificada.")}`,
    "",
    `<b>Reescrita da seção Sobre</b>\n${escapeHtml(report.aboutRewrite)}`,
    "",
    "<b>Recomendações</b>",
    ...report.recommendations.map((item) => `• ${escapeHtml(item)}`),
  ];
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: lines.join("\n").slice(0, 3900),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
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

export async function sendHuggingFaceQuotaAlert(postId: string): Promise<void> {
  const { chatId } = requireTelegramConfig();
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: [
      "<b>⚠️ Alerta de Sistema</b>",
      "A cota da Hugging Face esgotou. O seu feedback foi salvo.",
      "O post será gerado usando o provedor de fallback ou aguardará novos créditos.",
      postMarker(postId),
    ].join("\n\n"),
    parse_mode: "HTML",
  });
}

export async function sendCareerDigest(result: {
  matches: Array<{ title: string; company: string | null; location: string | null; url: string; score: number; label: string; skillGaps: string[] }>;
  queries: number;
  discovered: number;
  message: string;
}): Promise<void> {
  const { chatId } = requireTelegramConfig();
  const lines = [
    "<b>Radar de carreira atualizado</b>",
    escapeHtml(result.message),
    `Consultas: ${result.queries} · Vagas encontradas: ${result.discovered}`,
  ];
  for (const match of result.matches.slice(0, 8)) {
    lines.push("", `<b>${escapeHtml(match.title)}</b>`, `${escapeHtml(match.company ?? "Empresa não informada")} · ${escapeHtml(match.location ?? "Local não informado")}`, `Match: ${Math.round(match.score)}/100 (${escapeHtml(match.label)})`, match.skillGaps.length ? `Gaps: ${escapeHtml(match.skillGaps.join(", "))}` : "Gaps: nenhum detectado", `<a href="${escapeHtml(match.url)}">Abrir vaga</a>`);
  }
  await telegramRequest("sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true });
}

export async function sendCareerSearchLinks(queries: Array<{ title: string; location: string; url: string }>): Promise<void> {
  const { chatId } = requireTelegramConfig();
  const titles = new Map<string, string>();
  for (const query of queries) if (!titles.has(query.title)) titles.set(query.title, query.url);
  const ordered = [...titles.entries()];
  const lines = [
    "<b>🎯 Radar Diário de Carreiras - Links de Busca</b>",
    "",
    "Escolha um cargo para abrir as vagas mais recentes no LinkedIn:",
    ...ordered.map(([title], index) => `${index + 1}. ${title}`),
    "",
    "💡 <i>Encontrou uma vaga interessante? Compartilhe ou use /vaga &lt;URL&gt; aqui no chat para gerar a análise de Match, Gaps e o Pitch do Recrutador.</i>",
  ];
  const inline_keyboard = ordered.map(([title, url]) => [{ text: `🔎 ${title}`, url }]);
  await telegramRequest("sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard } });
}

export function jobMarker(jobId: string): string {
  return `<code>vaga:${jobId}</code>`;
}

export async function sendCareerJobPrompt(chatId: number | string, jobId: string, url: string): Promise<void> {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: ["<b>🔎 Vaga recebida.</b>", "Responda a esta mensagem colando a descrição da vaga. Não faço scraping do LinkedIn; uso o conteúdo fornecido para calcular Match, Gaps e Pitch.", `<a href="${escapeHtml(url)}">Abrir vaga</a>`, jobMarker(jobId)].join("\n\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: "Cole a descrição da vaga" },
  });
}

export async function sendCareerJobAnalysis(chatId: number | string, analysis: { title: string; score: number; label: string; matchedSkills: string[]; skillGaps: string[]; rationale: string; pitch: string; jobUrl: string }, replyToMessageId?: number): Promise<void> {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    text: ["<b>📌 Análise da vaga</b>", `<b>${escapeHtml(analysis.title)}</b>`, `Match: <b>${Math.round(analysis.score)}/100</b> (${escapeHtml(analysis.label)})`, `✅ Aderências: ${escapeHtml(analysis.matchedSkills.join(", ") || "nenhuma identificada")}`, `⚠️ Gaps: ${escapeHtml(analysis.skillGaps.join(", ") || "nenhum evidente")}`, escapeHtml(analysis.rationale), "<b>Pitch sugerido</b>", escapeHtml(analysis.pitch), `<a href="${escapeHtml(analysis.jobUrl)}">Abrir vaga</a>`].join("\n\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}
