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

function requireGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY nao configurada.");
  return key;
}

function requireHuggingFaceToken(): string {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN nao configurado.");
  return token;
}

function responseContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const message = choices[0] && typeof choices[0] === "object"
    ? (choices[0] as { message?: unknown }).message
    : null;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" && content.trim() ? content : null;
}

function normalizeResponse(payload: unknown, provider: string): ChatResponse {
  if (!responseContent(payload)) {
    throw new Error(`${provider} nao retornou choices[0].message.content.`);
  }
  return payload as ChatResponse;
}

function geminiContents(request: ChatRequest): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
} {
  const system = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const contents = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" as const : "user" as const,
      parts: [{ text: message.content }],
    }));
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "Responda de acordo com as instruções." }] }],
  };
}

async function callGemini(request: ChatRequest): Promise<ChatResponse> {
  const key = requireGeminiKey();
  // The API currently reports gemini-3.6-flash as the supported Flash model.
  // GEMINI_MODEL remains configurable for environments pinned to another model.
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...geminiContents(request),
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.max_tokens,
        ...(request.response_format?.type === "json_object" ? { responseMimeType: "application/json" } : {}),
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${providerErrorText(payload)}`);
  const candidate = payload && typeof payload === "object" && Array.isArray((payload as { candidates?: unknown }).candidates)
    ? (payload as { candidates: unknown[] }).candidates[0]
    : null;
  const parts = candidate && typeof candidate === "object" && (candidate as { content?: unknown }).content
    && typeof (candidate as { content: { parts?: unknown } }).content === "object"
    ? (candidate as { content: { parts?: unknown } }).content.parts
    : null;
  const content = Array.isArray(parts)
    ? parts.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("").trim()
    : "";
  if (!content) throw new Error("Gemini nao retornou candidates[0].content.parts[0].text.");
  return { choices: [{ message: { content } }] };
}

async function callGroq(request: ChatRequest): Promise<ChatResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY nao configurada.");
  const configuredModel = process.env.GROQ_MODEL?.trim();
  const model = configuredModel && !/gpt-oss|llama-3\.1-8b-instant/i.test(configuredModel)
    ? configuredModel
    : "llama-3.3-70b-versatile";
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, model, max_tokens: Math.min(request.max_tokens ?? 2000, 3200) }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => null) as unknown;
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
      model: process.env.OPENROUTER_MODEL?.trim() || "meta-llama/llama-3.1-8b-instruct",
      max_tokens: Math.min(request.max_tokens ?? 2000, 3200),
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const res = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${providerErrorText(res)}`);
  if (!responseContent(res)) throw new Error("OpenRouter nao retornou choices[0].message.content.");
  return normalizeResponse(res, "OpenRouter");
}

async function callHuggingFace(request: ChatRequest): Promise<ChatResponse> {
  const client = new InferenceClient(requireHuggingFaceToken());
  const response = await client.chatCompletion(request as Parameters<InferenceClient["chatCompletion"]>[0]);
  return normalizeResponse(response, "Hugging Face");
}

/** Gemini primary; Groq, OpenRouter and Hugging Face are resilient fallbacks. */
export async function chatCompletionWithFallback(request: ChatRequest): Promise<ChatResponse> {
  const errors: string[] = [];
  for (const [provider, call] of [["Gemini", callGemini], ["Groq", callGroq], ["OpenRouter", callOpenRouter], ["Hugging Face", callHuggingFace]] as const) {
    try {
      return await call(request);
    } catch (error) {
      errors.push(`${provider}: ${providerErrorText(error)}`);
      console.warn(`[ai-provider] ${provider} indisponivel; tentando proximo fallback.`);
    }
  }
  throw new Error(`Nenhum provedor de IA respondeu: ${errors.join(" | ")}`);
}

export async function generateTextWithFallback(request: ChatRequest): Promise<ChatResponse> {
  return chatCompletionWithFallback(request);
}
