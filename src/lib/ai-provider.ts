import { InferenceClient } from "@huggingface/inference";

export interface ChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: Record<string, unknown>;
}

export interface ChatResponse {
  choices: Array<{ message: { content?: string | null } }>;
}

function providerErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

export function isAiCapacityError(error: unknown): boolean {
  const current = providerErrorText(error).toLowerCase();
  const cause = error instanceof Error ? error.cause : undefined;
  return /depleted|credits|quota|quota exceeded|rate.?limit|too many requests|\b429\b|unauthorized|\b401\b/.test(current)
    || (cause ? isAiCapacityError(cause) : false);
}

function requireHuggingFaceToken(): string {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN nao configurado.");
  return token;
}

function normalizeResponse(payload: unknown, provider: string): ChatResponse {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { choices?: unknown }).choices)) {
    throw new Error(`${provider} retornou uma resposta sem choices.`);
  }
  return payload as ChatResponse;
}

async function callGroq(request: ChatRequest): Promise<ChatResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY nao configurada.");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile" }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Groq ${response.status}: ${providerErrorText(payload)}`);
  return normalizeResponse(payload, "Groq");
}

async function callOpenRouter(request: ChatRequest): Promise<ChatResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY nao configurada.");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      "X-Title": "Autonomous LinkedIn Content Engine",
    },
    body: JSON.stringify({
      ...request,
      model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free",
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${providerErrorText(payload)}`);
  return normalizeResponse(payload, "OpenRouter");
}

/** HF first; Groq/OpenRouter are only attempted after a capacity/auth failure. */
export async function chatCompletionWithFallback(request: ChatRequest): Promise<ChatResponse> {
  try {
    const client = new InferenceClient(requireHuggingFaceToken());
    const response = await client.chatCompletion(request as Parameters<InferenceClient["chatCompletion"]>[0]);
    return normalizeResponse(response, "Hugging Face");
  } catch (error) {
    if (!isAiCapacityError(error)) throw error;
    const fallbackErrors: string[] = [];
    for (const fallback of [callGroq, callOpenRouter]) {
      try { return await fallback(request); }
      catch (fallbackError) { fallbackErrors.push(providerErrorText(fallbackError)); }
    }
    throw new Error(`Hugging Face indisponivel e fallbacks de texto falharam: ${fallbackErrors.join(" | ")}`, { cause: error });
  }
}
