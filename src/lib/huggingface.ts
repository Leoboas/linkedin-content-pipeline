import { InferenceClient } from "@huggingface/inference";
import type { EditorialPillar, FunnelStage, FormatType } from "@prisma/client";
import { generateTextWithFallback } from "@/lib/ai-provider";
import { assertContentQuality, contentQualityIssues } from "@/lib/content-quality";
import { CREATIVE_DIRECTION_PROMPT } from "../../config/creative-direction";
import type { ContentLanguage } from "@/lib/language-planner";

const TEXT_MODEL = "mistralai/Mistral-7B-Instruct-v0.3";

function getHuggingFaceClient(): InferenceClient {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN não configurado.");
  return new InferenceClient(token);
}

export interface GeneratedSlide {
  title: string;
  bullets: string[];
  code?: string;
  metrics?: string[];
}

export interface GeneratedPost {
  funnelStage: FunnelStage;
  editorialPillar: EditorialPillar;
  formatType: FormatType;
  title: string;
  textContent: string;
  slides: GeneratedSlide[];
  language?: ContentLanguage;
}

interface EditorialContext {
  themes: unknown;
  toneOfVoice: string;
  aidaRules: string;
  cvCases: string;
  language: string;
}

const validStages = new Set<FunnelStage>(["ATTENTION", "INTEREST", "DESIRE", "ACTION"]);
const validFormats = new Set<FormatType>(["CAROUSEL_PDF", "SINGLE_IMAGE", "TEXT_ONLY"]);

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Hugging Face retornou ${field} inválido.`);
  }
  return value.trim();
}

function postTextValue(post: Record<string, unknown>): unknown {
  return post.textContent ?? post.text ?? post.content ?? post.body;
}

function assertOutputLanguage(posts: GeneratedPost[], language: ContentLanguage): void {
  const ptTokens = new Set(["não", "nao", "você", "voce", "uma", "para", "com", "dados", "decisão", "decisao", "quando", "sobre", "está", "esta", "que"]);
  const enTokens = new Set(["the", "and", "with", "from", "your", "when", "data", "decision", "without", "because", "this", "that", "are", "is", "to"]);
  for (const post of posts) {
    const tokens = `${post.title} ${post.textContent} ${post.slides.map((slide) => `${slide.title} ${slide.bullets.join(" ")}`).join(" ")}`
      .toLocaleLowerCase("en-US").match(/[a-záéíóúãõç]+/giu) ?? [];
    const ptCount = tokens.filter((token) => ptTokens.has(token)).length;
    const enCount = tokens.filter((token) => enTokens.has(token)).length;
    if (language === "en-US" && ptCount >= enCount + 3) throw new Error(`Post retornado em português apesar do idioma solicitado: ${post.title}`);
    if (language === "pt-BR" && enCount >= ptCount + 4) throw new Error(`Post retornado em inglês apesar do idioma solicitado: ${post.title}`);
  }
}

function removeMarkdownFence(content: string): string {
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(content);
  return match?.[1]?.trim() ?? content.trim();
}

function parseModelJson(content: string): unknown {
  const cleaned = removeMarkdownFence(content);
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const firstObject = cleaned.indexOf("{");
    const lastObject = cleaned.lastIndexOf("}");
    if (firstObject >= 0 && lastObject > firstObject) {
      return JSON.parse(cleaned.slice(firstObject, lastObject + 1));
    }
    throw error;
  }
}

function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeFunnelStage(value: unknown, index: number): FunnelStage {
  const fallback: FunnelStage[] = ["ATTENTION", "INTEREST", "DESIRE", "ACTION"];
  const rawValue = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>).find((item): item is string => typeof item === "string")
      : undefined;
  if (!rawValue) return fallback[index % fallback.length];
  const label = normalizeLabel(rawValue);
  const aliases: Record<string, FunnelStage> = {
    ATTENTION: "ATTENTION",
    ATENCAO: "ATTENTION",
    INTEREST: "INTEREST",
    INTERESSE: "INTEREST",
    DESIRE: "DESIRE",
    DESEJO: "DESIRE",
    ACTION: "ACTION",
    ACAO: "ACTION",
  };
  const stage = aliases[label];
  return stage ?? fallback[index % fallback.length];
}

function normalizeFormatType(value: unknown, index: number): FormatType {
  const fallback: FormatType[] = ["CAROUSEL_PDF", "SINGLE_IMAGE", "TEXT_ONLY"];
  const rawValue = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>).find((item): item is string => typeof item === "string")
      : undefined;
  if (!rawValue) return fallback[index % fallback.length];
  const label = normalizeLabel(rawValue);
  const aliases: Record<string, FormatType> = {
    CAROUSEL_PDF: "CAROUSEL_PDF",
    CARROSSEL_PDF: "CAROUSEL_PDF",
    CAROUSEL: "CAROUSEL_PDF",
    CARROSSEL: "CAROUSEL_PDF",
    SINGLE_IMAGE: "SINGLE_IMAGE",
    IMAGE: "SINGLE_IMAGE",
    IMAGEM: "SINGLE_IMAGE",
    TEXT_ONLY: "TEXT_ONLY",
    TEXT: "TEXT_ONLY",
    TEXTO: "TEXT_ONLY",
  };
  const format = aliases[label];
  return format ?? fallback[index % fallback.length];
}

function normalizeEditorialPillar(value: unknown, index: number): EditorialPillar {
  const fallback: EditorialPillar[] = ["TOFU", "MOFU", "BOFU"];
  const rawValue = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>).find((item): item is string => typeof item === "string")
      : undefined;
  if (!rawValue) return fallback[index % fallback.length];
  const label = normalizeLabel(rawValue);
  const aliases: Record<string, EditorialPillar> = {
    TOFU: "TOFU",
    TOPO: "TOFU",
    MOFU: "MOFU",
    MEIO: "MOFU",
    BOFU: "BOFU",
    FUNDO: "BOFU",
  };
  return aliases[label] ?? fallback[index % fallback.length];
}

function parseSingleGeneratedPost(value: unknown, index: number): GeneratedPost {
  if (!value || typeof value !== "object") throw new Error("Post reformulado invalido.");
  const post = value as Record<string, unknown>;
  if (post.textContent === undefined) post.textContent = post.text ?? post.content ?? post.body;
  const funnelStage = normalizeFunnelStage(post.funnelStage, index);
  const editorialPillar = normalizeEditorialPillar(post.editorialPillar ?? post.pillar, index);
  const formatType = normalizeFormatType(post.formatType, index);
  if (!validStages.has(funnelStage) || !validFormats.has(formatType)) {
    throw new Error("Taxonomia invalida no post reformulado.");
  }
  const slides: GeneratedSlide[] = Array.isArray(post.slides)
    ? post.slides.map((rawSlide, slideIndex) => {
        if (!rawSlide || typeof rawSlide !== "object") throw new Error(`Lamina ${slideIndex + 1} invalida.`);
        const slide = rawSlide as Record<string, unknown>;
        return {
          title: asString(slide.title, `titulo da lamina ${slideIndex + 1}`),
          bullets: Array.isArray(slide.bullets) ? slide.bullets.map((bullet) => asString(bullet, "bullet")) : [],
          ...(typeof slide.code === "string" ? { code: slide.code } : {}),
          ...(Array.isArray(slide.metrics) ? { metrics: slide.metrics.map((metric) => asString(metric, "metrica")) } : {}),
        };
      })
    : [];
  return {
    funnelStage,
    editorialPillar,
    formatType,
    title: asString(post.title, "titulo do post reformulado"),
    textContent: asString(post.textContent, "texto do post reformulado"),
    slides,
  };
}

function parseGeneratedPosts(value: unknown, requestedCount = 3): GeneratedPost[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { posts?: unknown }).posts)) {
    throw new Error("A resposta da Hugging Face não contém uma lista de posts.");
  }
  const rawPosts = (value as { posts: unknown[] }).posts;
  const minimum = requestedCount === 3 ? 3 : requestedCount;
  if (rawPosts.length < minimum || rawPosts.length > (requestedCount === 3 ? 4 : requestedCount)) {
    throw new Error(`A Hugging Face retornou ${rawPosts.length} posts; eram esperados ${requestedCount}.`);
  }

  return rawPosts.map((rawPost, index) => {
    if (!rawPost || typeof rawPost !== "object") throw new Error(`Post ${index + 1} inválido.`);
    const post = rawPost as Record<string, unknown>;
    if (post.textContent === undefined) post.textContent = post.text ?? post.content ?? post.body;
    const funnelStage = normalizeFunnelStage(post.funnelStage, index);
    const editorialPillar = normalizeEditorialPillar(post.editorialPillar ?? post.pillar, index);
    const formatType = normalizeFormatType(post.formatType, index);
    if (!validStages.has(funnelStage) || !validFormats.has(formatType)) throw new Error(`Taxonomia inválida no post ${index + 1}.`);

    const slides: GeneratedSlide[] = Array.isArray(post.slides)
      ? post.slides.map((rawSlide, slideIndex) => {
          if (!rawSlide || typeof rawSlide !== "object") throw new Error(`Lâmina ${slideIndex + 1} inválida no post ${index + 1}.`);
          const slide = rawSlide as Record<string, unknown>;
          return {
            title: asString(slide.title, `título da lâmina ${slideIndex + 1}`),
            bullets: Array.isArray(slide.bullets) ? slide.bullets.map((bullet) => asString(bullet, "bullet")) : [],
            ...(typeof slide.code === "string" ? { code: slide.code } : {}),
            ...(Array.isArray(slide.metrics) ? { metrics: slide.metrics.map((metric) => asString(metric, "métrica")) } : {}),
          };
        })
      : [];

    return {
      funnelStage,
      editorialPillar,
      formatType,
      title: asString(post.title, `título do post ${index + 1}`),
      textContent: asString(post.textContent, `texto do post ${index + 1}`),
      slides,
    };
  });
}

function ensureVisualMix(posts: GeneratedPost[]): GeneratedPost[] {
  return posts.map((post) => {
    const slides = post.slides.length > 0
      ? post.slides
      : [{
          title: post.title,
          bullets: post.textContent
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 5),
        }];
    const signatures = slides.map((slide) => (slide.title + "|" + slide.bullets.join("|")).toLowerCase().trim());
    const hasNarrative = slides.length >= 5 && new Set(signatures).size === signatures.length;
    return {
      ...post,
      formatType: post.formatType === "CAROUSEL_PDF" && !hasNarrative ? "SINGLE_IMAGE" : post.formatType,
      slides,
    };
  });
}

function ensureConversationalCta(posts: GeneratedPost[]): GeneratedPost[] {
  // CTA presence is reviewed as editorial quality; a repeated fallback question
  // made unrelated posts sound mass-produced, so this function no longer injects copy.
  return posts;
}

function assertBatchQuality(posts: GeneratedPost[]): void {
  const pillars = posts.map((post) => post.editorialPillar);
  if (new Set(pillars).size !== 3 || !pillars.includes("TOFU") || !pillars.includes("MOFU") || !pillars.includes("BOFU")) {
    throw new Error("O lote nao contem exatamente um post de cada pilar editorial.");
  }
  for (const post of posts) assertContentQuality(post);
}

function needsEditorialRefinement(posts: GeneratedPost[]): boolean {
  return posts.some((post) => contentQualityIssues(post).length > 0);
}

async function refineGeneratedPosts(posts: GeneratedPost[], ragSystemPrompt?: string, language: ContentLanguage = "pt-BR"): Promise<GeneratedPost[]> {
  const completion = await generateTextWithFallback({
    model: TEXT_MODEL,
    temperature: 0.55,
    max_tokens: 6000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          ragSystemPrompt,
          language === "en-US" ? "You are the final senior editor for B2B LinkedIn content in professional English." : "Você é a editora sênior final de conteúdo B2B para LinkedIn em português brasileiro.",
          "Rewrite the drafts with original, specific and useful content. Keep exactly one TOFU, one MOFU and one BOFU.",
          "Each post must have a strong hook in the first two lines, 500 to 1400 characters, at least two concrete technical details or trade-offs, and a conversational CTA.",
          language === "en-US" ? "Write like a hands-on engineer: short flowing paragraphs, direct storytelling and idiomatic professional English." : "Escreva como um engenheiro brasileiro que resolveu o problema: parágrafos curtos, narrativa direta e gramática correta.",
          language === "en-US" ? "All post prose and visual labels must stay in English." : "Toda a prosa e os rótulos visuais devem permanecer em português brasileiro.",
          "Never use AI-speak such as 'no mundo dinâmico de hoje', 'revolucionário', 'desvendar', 'desbloquear', 'mergulhar' or 'alavancar'. Avoid excessive hyphens, em dashes, emojis and list-like filler. Never invent metrics, clients or outcomes.",
          "Return only valid JSON in the format {posts:[...]}.",
        ].filter(Boolean).join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          drafts: posts,
          instruction: "Preserve the editorial pillars and AIDA stages, but replace generic copy with actionable insight and evidence from the dossier.",
        }),
      },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("A Hugging Face retornou uma resposta vazia na revisao editorial.");
  const refined = ensureConversationalCta(ensureVisualMix(parseGeneratedPosts(parseModelJson(content))).map((post) => ({ ...post, language })));
  assertOutputLanguage(refined, language);
  assertBatchQuality(refined);
  return refined;
}

async function repairSinglePost(input: {
  draft: GeneratedPost;
  feedback: string;
  editorialPillar: EditorialPillar;
  funnelStage: FunnelStage;
  formatType: FormatType;
  language?: ContentLanguage;
  issues: string[];
  ragSystemPrompt?: string;
}): Promise<GeneratedPost> {
  const completion = await generateTextWithFallback({
    model: TEXT_MODEL,
    temperature: 0.35,
    max_tokens: 3000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          input.ragSystemPrompt,
          input.language === "en-US" ? "You are a senior English-language LinkedIn editor performing the final quality review." : "Você é uma editora sênior de LinkedIn em português brasileiro e está fazendo a revisão final de qualidade.",
          input.language === "en-US" ? "Keep all prose, slides and labels in natural professional English." : "Mantenha toda a prosa, lâminas e rótulos em português brasileiro natural.",
          "Corrija todos os problemas listados sem perder os fatos, o pilar editorial, o contexto tecnico ou o feedback do autor.",
          input.language === "en-US" ? "Write 500–1400 characters in 4–7 short paragraphs, with a strong opening hook and a conversational CTA." : "Entregue entre 500 e 1400 caracteres, em 4 a 7 parágrafos curtos, com gancho forte e CTA conversacional.",
          input.language === "en-US" ? "Do not repeat the title at the beginning. Never invent metrics, clients, results or credentials." : "Não repita o título no início. Não invente métricas, clientes, resultados ou credenciais.",
          input.language === "en-US" ? "Avoid generic AI clichés and list-like filler." : "Evite clichês genéricos de IA e listas corridas.",
          input.language === "en-US" ? "Preserve the exact editorial pillar and funnel stage. Return only valid JSON in {post:{funnelStage,editorialPillar,formatType,title,textContent,slides}} format." : "Mantenha exatamente o pilar editorial e a etapa recebidos. Retorne somente JSON válido no formato {post:{funnelStage,editorialPillar,formatType,title,textContent,slides}}.",
        ].filter(Boolean).join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          draft: input.draft,
          authorFeedback: input.feedback,
          qualityFailures: input.issues,
          lockedTaxonomy: {
            editorialPillar: input.editorialPillar,
            funnelStage: input.funnelStage,
            formatType: input.formatType,
          },
        }),
      },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("A Hugging Face retornou uma resposta vazia no reparo editorial.");
  const parsed = parseModelJson(content) as { post?: unknown };
  const candidate = parseSingleGeneratedPost(parsed.post ?? parsed, 0);
  const repaired = ensureConversationalCta([{
    ...candidate,
    editorialPillar: input.editorialPillar,
    funnelStage: input.funnelStage,
    formatType: input.formatType,
  }])[0];
  assertOutputLanguage([repaired], input.language ?? "pt-BR");
  assertContentQuality(repaired, { expectedPillar: input.editorialPillar });
  return repaired;
}

export async function generateWeeklyPosts(
  context: EditorialContext,
  options: { ragSystemPrompt?: string; requestedCount?: 1 | 2 | 3 | 4; language?: ContentLanguage; excludeTopics?: string[] } = {},
): Promise<GeneratedPost[]> {
  const requestedCount = options.requestedCount ?? 3;
  const language = options.language ?? (context.language === "en-US" ? "en-US" : "pt-BR");
  const completion = await generateTextWithFallback({
    model: TEXT_MODEL,
    temperature: 0.75,
    max_tokens: 6000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          options.ragSystemPrompt,
          CREATIVE_DIRECTION_PROMPT,
          "Apply the RAG performance learnings: use a concrete hook in the first two lines, one real trade-off, authorized evidence and a conversational CTA. Never invent metrics.",
          language === "en-US"
            ? "Write in natural professional English for international engineering teams. Use idiomatic technical language; do not translate Portuguese sentence structures literally. Every post field, including slide titles, labels, hook and CTA, must be English."
            : "Escreva em português brasileiro natural, com parágrafos curtos e voz prática de engenharia. Todos os campos devem ficar em português, preservando nomes próprios e termos técnicos consagrados.",
          "Choose the format by content need: TEXT_ONLY for a short decision, SINGLE_IMAGE for one visual idea, and CAROUSEL_PDF only when there is a technical narrative with at least five distinct slides.",
          "Você é um estrategista sênior de conteúdo B2B para LinkedIn.",
          language === "en-US" ? "The required output language is English (en-US). Do not write Portuguese prose." : "O idioma obrigatório da saída é português brasileiro (pt-BR). Não escreva prosa em inglês.",
          "Use AIDA: ATTENTION captura atenção com uma tensão real; INTEREST ensina; DESIRE mostra transformação e prova; ACTION contém um próximo passo claro.",
          "O conteúdo deve ser específico para Tech Leadership, Engenharia de Dados e Growth, sem clichês corporativos.",
          "Retorne somente JSON válido no formato {posts:[...]}, sem markdown fora dos campos.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          task: `${language === "en-US" ? "Create" : "Crie"} exactly ${requestedCount} posts in ${language}. Use a distinct topic for each post and distribute AIDA stages.`,
          excludedTopics: options.excludeTopics ?? [],
          editorialLine: context,
          contract: {
            funnelStage: ["ATTENTION", "INTEREST", "DESIRE", "ACTION"],
            editorialPillar: ["TOFU", "MOFU", "BOFU"],
            formatType: ["CAROUSEL_PDF", "SINGLE_IMAGE", "TEXT_ONLY"],
            title: "título curto e forte",
            textContent: "texto final pronto para publicação, com quebras de linha e CTA quando apropriado",
            slides: "para CAROUSEL_PDF, 3 a 7 lâminas; cada lâmina tem title, bullets, opcionalmente code e metrics",
          },
        }),
      },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("A Hugging Face retornou uma resposta vazia.");
  try {
     const parsed = ensureConversationalCta(ensureVisualMix(parseGeneratedPosts(parseModelJson(content), requestedCount)));
     if (requestedCount !== 3) {
       assertOutputLanguage(parsed, language);
       return parsed.map((post) => ({ ...post, language }));
     }
     if (!needsEditorialRefinement(parsed)) {
       assertBatchQuality(parsed);
       assertOutputLanguage(parsed, language);
       return parsed.map((post) => ({ ...post, language }));
     }
     const refined = await refineGeneratedPosts(parsed, options.ragSystemPrompt, language);
     assertOutputLanguage(refined, language);
     return refined.map((post) => ({ ...post, language }));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Não foi possível interpretar o JSON retornado pela Hugging Face.", { cause: error });
    throw error;
  }
}

export async function regeneratePostWithFeedback(input: {
  oldTitle: string;
  oldText: string;
  feedback: string;
  editorialPillar: EditorialPillar;
  funnelStage?: FunnelStage;
  formatType?: FormatType;
  ragSystemPrompt?: string;
  language?: ContentLanguage;
}): Promise<GeneratedPost> {
  const language = input.language ?? "pt-BR";
  const completion = await generateTextWithFallback({
    model: TEXT_MODEL,
    temperature: 0.75,
    max_tokens: 3000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          input.ragSystemPrompt,
          CREATIVE_DIRECTION_PROMPT,
          language === "en-US" ? "You are a senior B2B technical content strategist for LinkedIn." : "Você é um estrategista sênior de conteúdo B2B para LinkedIn.",
          language === "en-US" ? "Rewrite the post in natural professional English, preserving its editorial pillar and applying the feedback." : "Reescreva o post em português brasileiro natural, preservando o pilar editorial e aplicando o feedback.",
          language === "en-US" ? "All prose, slide text and labels must remain in English; do not translate Portuguese sentence patterns literally." : "Todos os campos narrativos e rótulos devem permanecer em português brasileiro.",
          language === "en-US" ? "Write like an engineer who experienced the problem: concise paragraphs, direct storytelling, polished grammar and no generic AI clichés." : "Escreva como um engenheiro que viveu o problema: parágrafos curtos, narrativa direta, gramática revisada e sem clichês de IA.",
          "Return only valid JSON in {post:{funnelStage,editorialPillar,formatType,title,textContent,slides}} format.",
        ].filter(Boolean).join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          oldPost: { title: input.oldTitle, textContent: input.oldText, editorialPillar: input.editorialPillar },
          feedback: input.feedback,
          requiredLanguage: language,
          contract: {
            funnelStage: ["ATTENTION", "INTEREST", "DESIRE", "ACTION"],
            editorialPillar: input.editorialPillar,
            formatType: ["CAROUSEL_PDF", "SINGLE_IMAGE", "TEXT_ONLY"],
            slides: "lista opcional de laminas com title, bullets, code e metrics",
          },
        }),
      },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("A Hugging Face retornou uma resposta vazia na reformulacao.");
  try {
    const parsed = parseModelJson(content) as { post?: unknown };
    const candidate = parseSingleGeneratedPost(parsed.post ?? parsed, 0);
    const locked = {
      ...candidate,
      editorialPillar: input.editorialPillar,
      funnelStage: input.funnelStage ?? candidate.funnelStage,
      formatType: input.formatType ?? candidate.formatType,
    };
    const normalized = ensureConversationalCta(ensureVisualMix([locked]))[0];
    assertOutputLanguage([normalized], language);
    const issues = contentQualityIssues(normalized, { expectedPillar: input.editorialPillar });
    if (issues.length === 0) return { ...normalized, language };
    return { ...await repairSinglePost({
      draft: normalized,
      feedback: input.feedback,
      editorialPillar: input.editorialPillar,
      funnelStage: input.funnelStage ?? normalized.funnelStage,
      formatType: input.formatType ?? normalized.formatType,
      language,
      issues,
      ragSystemPrompt: input.ragSystemPrompt,
    }), language };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Nao foi possivel interpretar o JSON da reformulacao.", { cause: error });
    }
    throw error;
  }
}

export const huggingFaceModels = { text: TEXT_MODEL, image: "satori-or-unsplash" } as const;
