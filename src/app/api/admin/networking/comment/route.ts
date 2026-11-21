import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { NETWORKING_APPROACHES } from "../../../../../../config/networking";
import { generateTextWithFallback } from "@/lib/ai-provider";
import { buildNetworkingCommentMessages, networkingStartOfToday, validateNetworkingComment } from "@/lib/networking";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 30;

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/gu, "").split(/[^a-z0-9+#.]+/u).filter((item) => item.length > 2));
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  if (typeof body.referenceId !== "string" || !body.referenceId) return NextResponse.json({ error: "Selecione uma discussão salva." }, { status: 400 });
  if (typeof body.approach !== "string" || !NETWORKING_APPROACHES.includes(body.approach as typeof NETWORKING_APPROACHES[number])) return NextResponse.json({ error: "Escolha uma abordagem válida." }, { status: 400 });

  const reference = await prisma.networkingReference.findUnique({ where: { id: body.referenceId }, include: { commentDrafts: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!reference || reference.status === "ARCHIVED") return NextResponse.json({ error: "Discussão não encontrada ou arquivada." }, { status: 404 });
  if (reference.content.trim().length < 80) return NextResponse.json({ error: "Contexto insuficiente. Cole o texto da publicação (ao menos 80 caracteres); o sistema não raspa o LinkedIn." }, { status: 422 });
  const dailyLimit = Math.min(30, Math.max(1, Number(process.env.NETWORKING_AI_DAILY_LIMIT) || 12));

  const phrase = `${reference.title ?? ""} ${reference.summary ?? ""} ${reference.content}`;
  const phraseTokens = tokens(phrase);
  const [facts, projects, experiences] = await Promise.all([
    prisma.professionalFact.findMany({ where: { publicAllowed: true, visibility: "PUBLIC_SAFE", evidenceStatus: { in: ["VERIFIED", "DOCUMENTED", "USER_CONFIRMED"] }, sources: { some: {} } }, select: { id: true, claim: true }, take: 40 }),
    prisma.portfolioProject.findMany({ where: { publicAllowed: true, visibility: "PUBLIC_SAFE", evidenceStatus: { in: ["VERIFIED", "DOCUMENTED", "USER_CONFIRMED"] }, implementationStatus: { in: ["IMPLEMENTED", "USED_IN_PORTFOLIO"] }, sources: { some: {} } }, select: { id: true, name: true, summary: true, technologies: true, publicUrl: true }, take: 30 }),
    prisma.professionalExperience.findMany({ where: { publicAllowed: true, visibility: "PUBLIC_SAFE", evidenceStatus: { in: ["VERIFIED", "DOCUMENTED", "USER_CONFIRMED"] }, sources: { some: {} } }, select: { id: true, title: true, company: true, summary: true, technologies: true }, take: 25 }),
  ]);
  const overlap = (text: string) => [...tokens(text)].filter((token) => phraseTokens.has(token)).length;
  const evidence = [
    ...facts.map((item) => ({ id: item.id, kind: "verified professional fact", text: item.claim, score: overlap(item.claim) })),
    ...projects.map((item) => ({ id: item.id, kind: "verified portfolio implementation", text: `${item.name}: ${item.summary}; technologies: ${Array.isArray(item.technologies) ? item.technologies.join(", ") : "not specified"}; source: ${item.publicUrl ?? "not provided"}`, score: overlap(`${item.name} ${item.summary} ${Array.isArray(item.technologies) ? item.technologies.join(" ") : ""}`) })),
    ...experiences.map((item) => ({ id: item.id, kind: "verified professional experience", text: `${item.title} at ${item.company}: ${item.summary}; technologies: ${Array.isArray(item.technologies) ? item.technologies.join(", ") : "not specified"}`, score: overlap(`${item.title} ${item.company} ${item.summary}`) })),
  ].filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 5).map(({ id, kind, text }) => ({ id, kind, text: text.slice(0, 700) }));

  const language = reference.language === "pt-BR" ? "Brazilian Portuguese" : reference.language === "en" ? "English" : "the language used by the source post";
  const messages = buildNetworkingCommentMessages({
    approach: body.approach as typeof NETWORKING_APPROACHES[number], language,
    title: reference.title, authorRole: reference.authorRole, companyName: reference.companyName,
    sourcePostData: reference.content, summary: reference.summary, evidence,
  });
  const budgetStart = networkingStartOfToday();
  const budgetReservation = await prisma.$transaction(async (tx) => {
    const lockKey = `networking-ai:${budgetStart.toISOString().slice(0, 10)}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const [attemptsToday, attemptsForReference] = await Promise.all([
      tx.networkingAiAttempt.count({ where: { createdAt: { gte: budgetStart } } }),
      tx.networkingAiAttempt.count({ where: { referenceId: reference.id, createdAt: { gte: budgetStart } } }),
    ]);
    if (attemptsToday >= dailyLimit) return { blocked: `Limite diário de tentativas de IA atingido (${dailyLimit}); falhas também contam.` };
    if (attemptsForReference >= 3) return { blocked: "Limite de 3 tentativas de comentário por discussão no dia atingido." };
    const attempt = await tx.networkingAiAttempt.create({ data: { referenceId: reference.id, status: "STARTED" } });
    return { attemptId: attempt.id, attemptsToday };
  });
  if ("blocked" in budgetReservation) return NextResponse.json({ error: budgetReservation.blocked }, { status: 429 });
  const attemptId = budgetReservation.attemptId;
  try {
    const completion = await generateTextWithFallback({ model: "gemini-3.6-flash", temperature: 0.35, max_tokens: 500, response_format: { type: "json_object" }, messages: [
      ...messages,
    ] });
    const raw = completion.choices[0]?.message.content?.trim() ?? "";
    const result = JSON.parse(raw) as { ready?: unknown; comment?: unknown; rationale?: unknown };
    if (result.ready !== true) {
      await prisma.networkingAiAttempt.update({ where: { id: attemptId }, data: { status: "FAILED", errorCategory: "insufficient-context", finishedAt: new Date() } });
      return NextResponse.json({ error: typeof result.rationale === "string" ? result.rationale.slice(0, 500) : "Ainda não há contexto suficiente para um comentário relevante." }, { status: 422 });
    }
    if (typeof result.comment !== "string" || result.comment.trim().length < 25 || result.comment.length > 1_200 || /#\w/u.test(result.comment)) {
      await prisma.networkingAiAttempt.update({ where: { id: attemptId }, data: { status: "FAILED", errorCategory: "invalid-output", finishedAt: new Date() } });
      return NextResponse.json({ error: "A sugestão não passou na validação editorial. Tente outra abordagem ou revise o texto da publicação." }, { status: 422 });
    }
    const finalComment = result.comment.trim();
    const rationale = typeof result.rationale === "string" ? result.rationale.trim().slice(0, 500) : "Rascunho baseado no texto fornecido; revise antes de copiar.";
    const unsupportedClaims = validateNetworkingComment({ comment: finalComment, sourcePostData: reference.content, evidence });
    if (unsupportedClaims.length) {
      await prisma.networkingAiAttempt.update({ where: { id: attemptId }, data: { status: "FAILED", errorCategory: "unsupported-claim", finishedAt: new Date() } });
      return NextResponse.json({ error: "A sugestão contém afirmações pessoais ou números sem suporte na fonte/evidências autorizadas. Tente uma pergunta técnica ou revise o texto original.", unsupportedClaims }, { status: 422 });
    }
    const [draft] = await prisma.$transaction(async (tx) => {
      const saved = await tx.networkingCommentDraft.create({ data: { referenceId: reference.id, approach: body.approach as typeof NETWORKING_APPROACHES[number], comment: finalComment, rationale } });
      await tx.networkingActivity.create({ data: { type: "COMMENT_PREPARED", referenceId: reference.id, commentDraftId: saved.id, topicKey: reference.topicKey, language: reference.language, companyName: reference.companyName, professionalRole: reference.authorRole, preparedComment: saved.comment } });
      await tx.networkingReference.update({ where: { id: reference.id }, data: { status: "COMMENT_PREPARED" } });
      await tx.networkingAiAttempt.update({ where: { id: attemptId }, data: { status: "SUCCEEDED", finishedAt: new Date() } });
      return [saved];
    });
    return NextResponse.json({ draft, evidenceUsed: evidence.map(({ id, kind }) => ({ id, kind })), attemptsRemaining: dailyLimit - budgetReservation.attemptsToday - 1 });
  } catch (error) {
    console.error("[networking-comment] generation failed", error instanceof Error ? error.name : "unknown");
    await prisma.networkingAiAttempt.update({ where: { id: attemptId }, data: { status: "FAILED", errorCategory: "provider-or-validation", finishedAt: new Date() } }).catch(() => undefined);
    return NextResponse.json({ error: "Não foi possível gerar o comentário. Nenhuma interação foi enviada ao LinkedIn." }, { status: 502 });
  }
}
