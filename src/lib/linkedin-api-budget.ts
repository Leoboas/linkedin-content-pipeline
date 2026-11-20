import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class LinkedInApiBudgetExceeded extends Error {
  constructor(readonly budget: number) {
    super(`Orçamento diário de chamadas LinkedIn atingido (${budget}).`);
    this.name = "LinkedInApiBudgetExceeded";
  }
}

export function getLinkedInDailyBudget(): number {
  const raw = process.env.LINKEDIN_API_DAILY_BUDGET ?? process.env.LINKEDIN_ANALYTICS_DAILY_BUDGET;
  if (!raw) return 30;
  const budget = Number(raw);
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 1000) {
    throw new Error("LINKEDIN_ANALYTICS_DAILY_BUDGET deve ser inteiro entre 1 e 1000.");
  }
  return budget;
}

export async function getAvailableLinkedInApiCalls(now = new Date()): Promise<number | null> {
  if (process.env.LINKEDIN_API_BUDGET_ENABLED !== "true") return null;
  const used = await prisma.linkedInApiCall.count({ where: { createdAt: { gte: new Date(now.getTime() - ROLLING_WINDOW_MS) } } });
  return Math.max(0, getLinkedInDailyBudget() - used);
}

async function reserveCall(endpoint: string, operation: string): Promise<string | null> {
  if (process.env.LINKEDIN_API_BUDGET_ENABLED !== "true") return null;
  const budget = getLinkedInDailyBudget();
  const rollingWindowStart = new Date(Date.now() - ROLLING_WINDOW_MS);
  const id = randomUUID();

  // Serializable transaction prevents concurrent Vercel invocations from exceeding
  // the shared daily allowance. Fail closed only when the explicit budget flag is on.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const used = await tx.linkedInApiCall.count({ where: { createdAt: { gte: rollingWindowStart } } });
        if (used >= budget) throw new LinkedInApiBudgetExceeded(budget);
        await tx.linkedInApiCall.create({ data: { id, endpoint, operation } });
      }, { isolationLevel: "Serializable" });
      return id;
    } catch (error) {
      if (error instanceof LinkedInApiBudgetExceeded) throw error;
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2034") || attempt === 2) throw error;
    }
  }
  throw new Error("Não foi possível reservar uma chamada do LinkedIn.");
}

async function finishCall(id: string | null, statusCode: number | null): Promise<void> {
  if (!id) return;
  try {
    await prisma.linkedInApiCall.update({ where: { id }, data: { statusCode } });
  } catch (error) {
    // The external call already happened. Never retry a publish because ledger
    // finalization failed; keep the original response and emit no credentials.
    console.error("[linkedin-api-budget] failed to finalize request ledger", error instanceof Error ? error.message : "unknown error");
  }
}

function retryDelay(response: Response | null, attempt: number): number {
  const header = response?.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1000));
    const dateDelay = Date.parse(header) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.min(30_000, Math.max(0, dateDelay));
  }
  return Math.min(15_000, 500 * 2 ** attempt);
}

export async function fetchLinkedInTracked(
  url: string,
  init: RequestInit,
  metadata: { endpoint: string; operation: string },
): Promise<Response> {
  let lastError: unknown;
  const method = (init.method ?? "GET").toUpperCase();
  const mayRetry = method === "GET" || method === "HEAD" || method === "PUT";
  const maxAttempts = mayRetry ? 3 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const callId = await reserveCall(metadata.endpoint, metadata.operation);
    let response: Response | null = null;
    try {
      response = await fetch(url, init);
      await finishCall(callId, response.status);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts - 1) return response;
    } catch (error) {
      lastError = error;
      await finishCall(callId, null);
      if (attempt === maxAttempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
  }
  throw lastError instanceof Error ? lastError : new Error("Falha transitória na API do LinkedIn.");
}

export function classifyLinkedInFailure(error: unknown): "unauthorized" | "forbidden" | "rate_limited" | "transient" | "other" {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b401\b/u.test(message)) return "unauthorized";
  if (/\b403\b/u.test(message)) return "forbidden";
  if (/\b429\b/u.test(message)) return "rate_limited";
  if (/\b(5\d\d|timeout|fetch failed|network)/iu.test(message)) return "transient";
  return "other";
}
