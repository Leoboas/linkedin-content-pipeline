import type { EditorialPillar } from "@prisma/client";
import { generateNewPostBatch } from "@/lib/content-engine";
import { reviewPostQuality, type PostQualityReview, type ReviewablePost } from "@/lib/content-reviewer";
import { generateTextWithFallback } from "@/lib/ai-provider";
import { auditLinkedInProfile, type ProfileAuditReport } from "@/lib/profile-auditor";
import { prisma } from "@/lib/prisma";

export interface HookAnalysis {
  formula: string;
  evidence: string;
  template: string;
}

export interface HumanizedDraft {
  text: string;
  changes: string[];
  emojiDensity: number;
  aiTellFlags: string[];
}

const AI_TELLS = [
  /no mundo dinâmico de hoje/gi,
  /revolucionário/gi,
  /desvendar/gi,
  /desbloquear/gi,
  /mergulhar/gi,
  /alavancar/gi,
  /virada de chave/gi,
];

export function extractHookFormula(title: string, textContent: string): HookAnalysis {
  const first = `${title}\n${textContent}`.split(/\r?\n/).find((line) => line.trim())?.trim() ?? title.trim();
  const hasQuestion = /[?¿]/.test(first);
  const hasNumber = /\d|%|R\$/.test(first);
  const hasContrast = /\b(mas|antes|depois|versus|vs\.?|não|nao)\b/i.test(first);
  const formula = hasQuestion ? "Pergunta de tensão" : hasContrast ? "Contraste técnico" : hasNumber ? "Abertura com evidência" : "Afirmação de ponto de vista";
  const template = hasQuestion
    ? "[Pergunta que expõe uma tensão real de engenharia]?"
    : hasContrast
      ? "[Decisão comum] não resolve [problema]. O trade-off está em [causa]."
      : hasNumber
        ? "[Resultado ou métrica] começou com uma decisão aparentemente pequena: [decisão]."
        : "[Opinião técnica específica]. O motivo é [evidência ou experiência].";
  return { formula, evidence: first, template };
}

export function humanizeDraft(text: string): HumanizedDraft {
  let output = text.trim();
  const changes: string[] = [];
  for (const pattern of AI_TELLS) {
    if (pattern.test(output)) {
      output = output.replace(pattern, "");
      changes.push("removido clichê genérico de IA");
    }
    pattern.lastIndex = 0;
  }
  const dashCount = (output.match(/—/g) ?? []).length;
  if (dashCount > 2) {
    output = output.replace(/—/g, ",");
    changes.push("reduzido excesso de travessões");
  }
  const emojiCount = [...output].filter((char) => /\p{Extended_Pictographic}/u.test(char)).length;
  const emojiDensity = output.length ? Math.round((emojiCount / output.length) * 1000) / 10 : 0;
  const aiTellFlags = AI_TELLS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  return { text: output.replace(/\s{2,}/g, " ").trim(), changes: [...new Set(changes)], emojiDensity, aiTellFlags };
}

export async function auditDraft(post: ReviewablePost): Promise<PostQualityReview & { hook: HookAnalysis; humanization: HumanizedDraft }> {
  const review = await reviewPostQuality(post);
  return { ...review, hook: extractHookFormula(post.title, post.textContent), humanization: humanizeDraft(post.textContent) };
}

async function generateConversationDraft(input: { task: string; context: string; instruction: string }): Promise<string> {
  const result = await generateTextWithFallback({
    model: process.env.LINKEDIN_WRITER_MODEL || "gemini-3.6-flash",
    temperature: 0.6,
    max_tokens: 800,
    messages: [
      {
        role: "system",
        content: "Você escreve no tom de um Python/Data Engineer sênior. Seja específico, humano e conciso. Não invente fatos. Não use clichês de IA nem prometa viralização. Retorne apenas o texto solicitado.",
      },
      { role: "user", content: `Tarefa: ${input.task}\nContexto:\n${input.context}\nInstrução: ${input.instruction}` },
    ],
  });
  const value = result.choices[0]?.message.content?.trim();
  if (!value) throw new Error("O gerador não retornou texto.");
  return humanizeDraft(value).text;
}

export function draftComment(input: { postText: string; angle?: string }): Promise<string> {
  return generateConversationDraft({ task: "Redator de comentário", context: input.postText, instruction: `Escreva um comentário de 2 a 4 linhas que acrescente uma observação técnica. Ângulo: ${input.angle ?? "trade-off ou experiência prática"}.` });
}

export function draftReply(input: { thread: string; replyTarget: string }): Promise<string> {
  return generateConversationDraft({ task: "Manipulador de resposta", context: input.thread, instruction: `Responda diretamente a este comentário: ${input.replyTarget}. Reconheça o ponto e acrescente uma ideia útil, sem repetir o post.` });
}

export async function getEngagementMonitor() {
  const metrics = await prisma.postMetric.findMany({
    where: { source: { in: ["LINKEDIN_API", "MANUAL"] }, availability: { in: ["AVAILABLE", "PARTIAL"] } },
    orderBy: { capturedAt: "desc" },
    take: 100,
    include: { post: { select: { id: true, title: true, editorialPillar: true, formatType: true, publishedAt: true } } },
  });
  return metrics.map((metric) => {
    const discussionObserved = metric.comments !== null && metric.shares !== null;
    const reactionsObserved = metric.reactions !== null;
    return {
      postId: metric.postId,
      title: metric.post.title,
      pillar: metric.post.editorialPillar,
      format: metric.post.formatType,
      capturedAt: metric.capturedAt,
      impressions: metric.impressions,
      reactions: metric.reactions,
      comments: metric.comments,
      shares: metric.shares,
      profileViews: metric.profileViewsFromContent,
      source: metric.source,
      measurementWindow: metric.measurementWindow,
      availability: metric.availability,
      interactionRate: metric.interactionRate,
      audienceSignal: !discussionObserved && !reactionsObserved
        ? "dados insuficientes"
        : (metric.comments ?? 0) + (metric.shares ?? 0) > 0
          ? "conversa/propagação"
          : (metric.reactions ?? 0) > 0 ? "interesse" : "sem sinal observado",
    };
  });
}

export function optimizeProfile(): Promise<ProfileAuditReport> {
  return auditLinkedInProfile();
}

export { generateNewPostBatch };

export function isPillar(value: string): value is EditorialPillar {
  return value === "TOFU" || value === "MOFU" || value === "BOFU";
}
