import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { DAILY_NETWORKING_STEPS, DEFAULT_NETWORKING_TOPICS, NETWORKING_ACTIVITY_TYPES } from "../../../../../config/networking";
import { canonicalizeLinkedInUrl, classifyNetworkingTopic, detectDiscussionLanguage, isSafeNetworkingText, networkingLocalDate, networkingStartOfToday, scoreNetworkingRelevance } from "@/lib/networking";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400): NextResponse { return NextResponse.json({ error: message }, { status }); }
function str(body: Record<string, unknown>, key: string, limit: number): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}
function enumValue<T extends readonly string[]>(value: unknown, options: T): value is T[number] { return typeof value === "string" && options.includes(value); }

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const status = url.searchParams.get("status") ?? "";
  const topicKey = url.searchParams.get("topic") ?? "";
  const language = url.searchParams.get("language") ?? "";
  const company = url.searchParams.get("company")?.trim().slice(0, 100) ?? "";
  const periodDays = url.searchParams.get("period") === "30d" ? 30 : 7;
  const since = new Date(Date.now() - periodDays * 86_400_000);
  const [references, activities, targets, topics, companies, routine, dailyActivities, dailyAiAttempts, dailyDraftCount, weeklyDraftCount] = await Promise.all([
    prisma.networkingReference.findMany({
      where: {
        ...(status && ["SAVED", "REVIEWED", "COMMENT_PREPARED", "INTERACTED", "ARCHIVED"].includes(status) ? { status: status as never } : {}), ...(topicKey ? { topicKey } : {}),
        ...(language ? { language } : {}), ...(company ? { companyName: { contains: company, mode: "insensitive" as const } } : {}),
        ...(query ? { OR: ["title", "summary", "content", "authorName", "companyName"].map((field) => ({ [field]: { contains: query, mode: "insensitive" as const } })) } : {}),
      },
      orderBy: [{ relevanceScore: "desc" }, { updatedAt: "desc" }], take: 250,
      include: { commentDrafts: { orderBy: { createdAt: "desc" }, take: 5 } },
    }),
    prisma.networkingActivity.findMany({ orderBy: { occurredAt: "desc" }, take: 100, include: { reference: { select: { id: true, title: true, canonicalUrl: true } }, commentDraft: { select: { comment: true, approach: true } } } }),
    prisma.networkingTarget.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.networkingTopic.findMany({ orderBy: [{ priority: "asc" }, { label: "asc" }] }),
    prisma.monitoredCompany.findMany({ where: { active: true }, orderBy: [{ priority: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.networkingRoutine.findUnique({ where: { localDate: networkingLocalDate() } }),
    prisma.networkingActivity.findMany({ where: { occurredAt: { gte: since } }, select: { type: true, publicationConfirmed: true, newRelevantConnection: true, conversationStarted: true, topicKey: true, language: true } }),
    prisma.networkingAiAttempt.count({ where: { createdAt: { gte: networkingStartOfToday() } } }),
    prisma.networkingCommentDraft.count({ where: { createdAt: { gte: networkingStartOfToday() } } }),
    prisma.networkingCommentDraft.count({ where: { createdAt: { gte: since } } }),
  ]);
  const activityStats = {
    discussionsReviewed: dailyActivities.filter((item) => item.type === "DISCUSSION_REVIEWED").length,
    commentsPrepared: weeklyDraftCount,
    commentsConfirmed: dailyActivities.filter((item) => item.type === "COMMENT_PUBLISHED" && item.publicationConfirmed).length,
    relevantConnections: dailyActivities.filter((item) => item.newRelevantConnection).length,
    conversationsStarted: dailyActivities.filter((item) => item.conversationStarted).length,
    completedThisWeek: dailyActivities.length,
    topicDistribution: Object.entries(dailyActivities.reduce<Record<string, number>>((counts, item) => { if (item.topicKey) counts[item.topicKey] = (counts[item.topicKey] ?? 0) + 1; return counts; }, {})).sort((a, b) => b[1] - a[1]),
    languageDistribution: Object.entries(dailyActivities.reduce<Record<string, number>>((counts, item) => { if (item.language) counts[item.language] = (counts[item.language] ?? 0) + 1; return counts; }, {})).sort((a, b) => b[1] - a[1]),
    trackedCompanies: companies.length,
    savedDiscussions: references.filter((item) => item.status !== "ARCHIVED").length,
    periodDays,
  };
  return NextResponse.json({
    references, activities, targets, topics: topics.length ? topics : DEFAULT_NETWORKING_TOPICS.map((topic) => ({ ...topic, active: true, priority: 50 })),
    companies, routine: routine ?? { localDate: networkingLocalDate().toISOString(), completed: {}, notes: "" },
    routineSteps: DAILY_NETWORKING_STEPS, activityStats,
    limits: { aiAttemptsToday: dailyAiAttempts, aiDraftsToday: dailyDraftCount, aiDraftsDailyLimit: Number(process.env.NETWORKING_AI_DAILY_LIMIT) || 12 },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonError("JSON inválido."); }
  try {
    if (body.action === "create-reference") {
      if (!isSafeNetworkingText(body.url, 2_000)) return jsonError("URL obrigatória.");
      const { canonicalUrl, sourceDomain } = canonicalizeLinkedInUrl(body.url);
      const content = str(body, "content", 10_000) ?? "";
      const title = str(body, "title", 300);
      const summary = str(body, "summary", 1_000);
      const authorRole = str(body, "authorRole", 160);
      const authorName = str(body, "authorName", 160);
      const companyName = str(body, "companyNameFree", 200) ?? str(body, "companyName", 200);
      const requestedTopicKey = str(body, "topicKey", 100);
      if (!content && !title && !summary) return jsonError("Cole o texto da publicação ou informe título/resumo para calcular relevância e preparar comentário.");
      const [existing, topics, monitoredCompanies, savedTargets] = await Promise.all([
        prisma.networkingReference.findUnique({ where: { canonicalUrl }, select: { id: true } }),
        prisma.networkingTopic.findMany({ where: { active: true }, orderBy: { priority: "asc" }, select: { key: true, label: true, keywords: true, priority: true } }),
        prisma.monitoredCompany.findMany({ where: { active: true }, select: { name: true } }),
        prisma.networkingTarget.findMany({ where: { type: "COMPANY" }, select: { name: true, companyName: true } }),
      ]);
      if (existing) return jsonError("Essa publicação já está salva.", 409);
      const topic = requestedTopicKey
        ? topics.find((item) => item.key === requestedTopicKey)
        : classifyNetworkingTopic(`${title ?? ""} ${summary ?? ""} ${content}`, topics);
      if (requestedTopicKey && !topic) return jsonError("O tema selecionado não está configurado.");
      const topicKey = topic?.key ?? null;
      const topicKeywords = Array.isArray(topic?.keywords) ? topic.keywords.filter((item): item is string => typeof item === "string") : [];
      const normalizedCompany = companyName?.toLocaleLowerCase("en-US");
      const knownCompany = Boolean(normalizedCompany && [...monitoredCompanies.map((item) => item.name), ...savedTargets.flatMap((item) => [item.name, item.companyName ?? ""])].some((name) => name.toLocaleLowerCase("en-US") === normalizedCompany));
      const scoring = scoreNetworkingRelevance({ content, title, summary, authorRole, companyName, knownCompany, topicKey, topicLabel: topic?.label, topicKeywords });
      const reference = await prisma.networkingReference.create({ data: {
        canonicalUrl, sourceDomain, content, title, summary, authorName, authorRole, companyName,
        language: str(body, "language", 20) ?? detectDiscussionLanguage(`${title ?? ""} ${summary ?? ""} ${content}`),
        topicKey, relevanceScore: scoring.score, relevanceRationale: scoring.rationale,
        notes: str(body, "notes", 2_000),
      } });
      return NextResponse.json({ reference }, { status: 201 });
    }
    if (body.action === "create-activity") {
      if (!enumValue(body.type, NETWORKING_ACTIVITY_TYPES)) return jsonError("Tipo de atividade inválido.");
      const type = body.type;
      const publicationConfirmed = body.publicationConfirmed === true;
      if (type === "COMMENT_PUBLISHED" && !publicationConfirmed) return jsonError("Confirme explicitamente que publicou o comentário manualmente.");
      if (type === "COMMENT_PUBLISHED" && !isSafeNetworkingText(body.publishedComment, 4_000)) return jsonError("Informe o comentário efetivamente publicado para registrar a confirmação.");
      const referenceId = str(body, "referenceId", 50);
      if (referenceId && !await prisma.networkingReference.findUnique({ where: { id: referenceId }, select: { id: true } })) return jsonError("Discussão não encontrada.", 404);
      const stableIdempotencyKey = str(body, "idempotencyKey", 200) ?? createHash("sha256").update(JSON.stringify({
        day: networkingLocalDate().toISOString(), type, referenceId, topicKey: str(body, "topicKey", 100),
        companyName: str(body, "companyName", 200), professionalRole: str(body, "professionalRole", 160),
        publishedComment: publicationConfirmed ? str(body, "publishedComment", 4_000) : null,
        notes: str(body, "notes", 2_000),
      })).digest("hex");
      const activityData = {
        type, referenceId, commentDraftId: str(body, "commentDraftId", 50),
        topicKey: str(body, "topicKey", 100), language: str(body, "language", 20),
        companyName: str(body, "companyName", 200), professionalRole: str(body, "professionalRole", 160),
        preparedComment: str(body, "preparedComment", 4_000), publishedComment: publicationConfirmed ? str(body, "publishedComment", 4_000) : null,
        publicationConfirmed, newRelevantConnection: type === "RELEVANT_CONNECTION", conversationStarted: type === "PROFESSIONAL_CONVERSATION",
        notes: str(body, "notes", 2_000), idempotencyKey: stableIdempotencyKey,
      };
      const idempotencyKey = activityData.idempotencyKey;
      const activity = idempotencyKey
        ? await prisma.networkingActivity.upsert({ where: { idempotencyKey }, create: activityData, update: {} })
        : await prisma.networkingActivity.create({ data: activityData });
      if (referenceId && type === "COMMENT_PUBLISHED") await prisma.networkingReference.update({ where: { id: referenceId }, data: { status: "INTERACTED" } });
      return NextResponse.json({ activity }, { status: 201 });
    }
    if (body.action === "create-target") {
      if (!enumValue(body.type, ["PROFESSIONAL", "COMPANY"] as const)) return jsonError("Tipo de alvo inválido.");
      const name = str(body, "name", 200);
      if (!name) return jsonError("Nome do alvo é obrigatório.");
      let linkedinUrl: string | null = null;
      const rawUrl = str(body, "linkedinUrl", 2_000);
      if (rawUrl) linkedinUrl = canonicalizeLinkedInUrl(rawUrl).canonicalUrl;
      const companyName = str(body, "companyNameFree", 200) ?? str(body, "companyName", 200) ?? (body.type === "COMPANY" ? name : null);
      const existingCompany = companyName ? await prisma.monitoredCompany.findFirst({ where: { name: { equals: companyName, mode: "insensitive" } }, select: { id: true, name: true } }) : null;
      const normalizedKey = `${body.type}:${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/gu, "")}:${(companyName ?? "").toLowerCase()}`;
      if (await prisma.networkingTarget.findUnique({ where: { targetKey: normalizedKey }, select: { id: true } })) return jsonError("Esse alvo já está na lista.", 409);
      const target = await prisma.networkingTarget.create({ data: {
        targetKey: normalizedKey, type: body.type, name, role: str(body, "role", 160),
        companyName: existingCompany?.name ?? companyName, region: str(body, "region", 100), linkedinUrl,
        monitoredCompanyId: existingCompany?.id ?? null, notes: str(body, "notes", 2_000),
      } });
      return NextResponse.json({ target }, { status: 201 });
    }
    if (body.action === "save-routine") {
      const completed = body.completed;
      if (!completed || typeof completed !== "object" || Array.isArray(completed)) return jsonError("Checklist inválido.");
      const allowed = new Set<string>(DAILY_NETWORKING_STEPS.map((step) => step.key));
      const clean = Object.fromEntries(Object.entries(completed).filter(([key, value]) => allowed.has(key) && typeof value === "boolean"));
      const routine = await prisma.networkingRoutine.upsert({
        where: { localDate: networkingLocalDate() },
        create: { localDate: networkingLocalDate(), completed: clean, notes: str(body, "notes", 2_000) },
        update: { completed: clean, notes: str(body, "notes", 2_000) },
      });
      return NextResponse.json({ routine });
    }
    if (body.action === "save-topic") {
      const key = str(body, "key", 100)?.toLowerCase().replace(/[^a-z0-9-]/gu, "-");
      const label = str(body, "label", 120);
      const keywords = Array.isArray(body.keywords) ? body.keywords.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 80)).filter(Boolean).slice(0, 30) : [];
      if (!key || !label || !keywords.length) return jsonError("Informe identificador, tema e pelo menos uma palavra-chave.");
      const topic = await prisma.networkingTopic.upsert({ where: { key }, create: { key, label, keywords }, update: { label, keywords, active: true } });
      return NextResponse.json({ topic });
    }
    return jsonError("Ação não reconhecida.");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return jsonError("Esse registro já existe.", 409);
    if (error instanceof Error && error.message.includes("URL")) return jsonError(error.message);
    console.error("[networking] falha ao persistir operação", error instanceof Error ? error.name : "unknown");
    return jsonError("Não foi possível salvar a operação. Verifique os dados e tente novamente.", 500);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonError("JSON inválido."); }
  try {
    if (body.action === "update-reference") {
      const id = str(body, "id", 50);
      if (!id) return jsonError("Identificador da discussão ausente.");
      const status = body.status;
      const allowedStatus = ["SAVED", "REVIEWED", "COMMENT_PREPARED", "INTERACTED", "ARCHIVED"] as const;
      if (!enumValue(status, allowedStatus)) return jsonError("Status inválido.");
      const data: Record<string, unknown> = { status };
      for (const field of ["title", "summary", "content", "authorName", "authorRole", "companyName", "topicKey", "language", "notes"] as const) {
        if (typeof body[field] === "string") data[field] = body[field].trim().slice(0, field === "content" ? 10_000 : field === "notes" ? 2_000 : 1_000);
      }
      if (status === "INTERACTED") return jsonError("Registre uma interação confirmada no Activity Tracker; não é possível marcar apenas o status.");
      if (status === "REVIEWED") data.reviewedAt = new Date();
      if (["title", "summary", "content", "authorRole", "companyName", "topicKey"].some((key) => typeof body[key] === "string")) {
        const existing = await prisma.networkingReference.findUnique({ where: { id }, select: { title: true, summary: true, content: true, authorRole: true, companyName: true, topicKey: true } });
        if (!existing) return jsonError("Discussão não encontrada.", 404);
        const merged = { ...existing, ...data };
        const topic = merged.topicKey ? await prisma.networkingTopic.findUnique({ where: { key: String(merged.topicKey) }, select: { label: true, keywords: true, priority: true } }) : null;
        const keywords = Array.isArray(topic?.keywords) ? topic.keywords.filter((item): item is string => typeof item === "string") : [];
        const scoring = scoreNetworkingRelevance({ content: String(merged.content), title: String(merged.title ?? ""), summary: String(merged.summary ?? ""), authorRole: String(merged.authorRole ?? ""), companyName: String(merged.companyName ?? ""), topicKey: String(merged.topicKey ?? ""), topicLabel: topic?.label, topicKeywords: keywords });
        data.relevanceScore = scoring.score;
        data.relevanceRationale = scoring.rationale;
      }
      const updated = await prisma.networkingReference.update({ where: { id }, data });
      return NextResponse.json({ reference: updated });
    }
    if (body.action === "save-routine") {
      return POST(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) }));
    }
    if (body.action === "save-topic") return POST(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) }));
    return jsonError("Ação não reconhecida.");
  } catch (error) {
    console.error("[networking] falha na atualização", error instanceof Error ? error.name : "unknown");
    return jsonError("Não foi possível atualizar o registro.", 500);
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return jsonError("Não autorizado.", 401);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonError("JSON inválido."); }
  try {
    if (body.resource === "reference" && typeof body.id === "string") {
      const reference = await prisma.networkingReference.update({ where: { id: body.id }, data: { status: "ARCHIVED" } });
      return NextResponse.json({ reference });
    }
    if (body.resource === "target" && typeof body.id === "string") {
      await prisma.networkingTarget.delete({ where: { id: body.id } });
      return NextResponse.json({ deleted: true });
    }
    if (body.resource === "topic" && typeof body.id === "string") {
      const topic = await prisma.networkingTopic.update({ where: { id: body.id }, data: { active: false } });
      return NextResponse.json({ topic });
    }
    return jsonError("Recurso não reconhecido.");
  } catch {
    return jsonError("Não foi possível remover o registro.", 500);
  }
}
