import { InferenceClient } from "@huggingface/inference";
import type { EditorialPillar, FunnelStage, FormatType } from "@prisma/client";

const TEXT_MODEL = "Qwen/Qwen2.5-Coder-32B-Instruct";
const IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell";

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

function parseGeneratedPosts(value: unknown): GeneratedPost[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { posts?: unknown }).posts)) {
    throw new Error("A resposta da Hugging Face não contém uma lista de posts.");
  }
  const rawPosts = (value as { posts: unknown[] }).posts;
  if (rawPosts.length < 3 || rawPosts.length > 4) {
    throw new Error(`A Hugging Face retornou ${rawPosts.length} posts; eram esperados 3 ou 4.`);
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
  const visualFormatByPillar: Record<EditorialPillar, FormatType> = {
    TOFU: "CAROUSEL_PDF",
    MOFU: "SINGLE_IMAGE",
    BOFU: "CAROUSEL_PDF",
  };
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
    return {
      ...post,
      formatType: post.formatType === "TEXT_ONLY" ? visualFormatByPillar[post.editorialPillar] : post.formatType,
      slides,
    };
  });
}

function needsEditorialRefinement(posts: GeneratedPost[]): boolean {
  const genericLanguage = /vamos explorar|continue com a gente|junte-se a nos|veja como implementamos|vamos olhar para/i;
  return posts.some((post) => {
    const content = `${post.title}\n${post.textContent}`;
    return post.textContent.length < 500
      || genericLanguage.test(content)
      || !/[!?]/.test(post.title)
      || !/(comente|qual|como|conhec|acesse|teste|compartilhe|responda)/i.test(post.textContent);
  });
}

async function refineGeneratedPosts(posts: GeneratedPost[], ragSystemPrompt?: string): Promise<GeneratedPost[]> {
  const completion = await getHuggingFaceClient().chatCompletion({
    model: TEXT_MODEL,
    temperature: 0.55,
    max_tokens: 6000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          ragSystemPrompt,
          "You are the final senior editor for B2B LinkedIn content in Brazilian Portuguese.",
          "Rewrite the drafts with original, specific and useful content. Keep exactly one TOFU, one MOFU and one BOFU.",
          "Each post must have a strong hook in the first two lines, 500 to 1400 characters, at least two concrete technical details or trade-offs, and a conversational CTA.",
          "Write like a Brazilian engineer who solved the problem: short flowing paragraphs, direct storytelling and correct Portuguese grammar.",
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
  return ensureVisualMix(parseGeneratedPosts(parseModelJson(content)));
}

export async function generateWeeklyPosts(
  context: EditorialContext,
  options: { ragSystemPrompt?: string } = {},
): Promise<GeneratedPost[]> {
  const completion = await getHuggingFaceClient().chatCompletion({
    model: TEXT_MODEL,
    temperature: 0.75,
    max_tokens: 6000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          options.ragSystemPrompt,
          "Apply the RAG performance learnings: use a concrete hook in the first two lines, one real trade-off, authorized evidence and a conversational CTA. Never invent metrics.",
          "Write in natural Brazilian Portuguese with short paragraphs and a practical engineer/tech-leader voice. Ban generic AI phrasing, excessive hyphens and list-like filler.",
          "For visual variety, use CAROUSEL_PDF for TOFU, SINGLE_IMAGE for MOFU and CAROUSEL_PDF for BOFU.",
          "Você é um estrategista sênior de conteúdo B2B para LinkedIn.",
          "Crie posts em português do Brasil, salvo indicação contrária.",
          "Use AIDA: ATTENTION captura atenção com uma tensão real; INTEREST ensina; DESIRE mostra transformação e prova; ACTION contém um próximo passo claro.",
          "O conteúdo deve ser específico para Tech Leadership, Engenharia de Dados e Growth, sem clichês corporativos.",
          "Retorne somente JSON válido no formato {posts:[...]}, sem markdown fora dos campos.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Crie exatamente 3 posts para a semana: um TOFU, um MOFU e um BOFU. Distribua as etapas AIDA entre eles.",
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
    const parsed = ensureVisualMix(parseGeneratedPosts(parseModelJson(content)));
    if (!needsEditorialRefinement(parsed)) return parsed;
    try {
      return await refineGeneratedPosts(parsed, options.ragSystemPrompt);
    } catch (refinementError) {
      console.warn("Revisao editorial automatica indisponivel; usando o primeiro rascunho:", refinementError);
      return parsed;
    }
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Não foi possível interpretar o JSON retornado pela Hugging Face.", { cause: error });
    throw error;
  }
}

export async function generateCreativeImage(prompt: string): Promise<Buffer> {
  const image = await getHuggingFaceClient().textToImage({
    model: IMAGE_MODEL,
    inputs: prompt,
    parameters: { width: 1024, height: 1024, num_inference_steps: 4 },
  }, { outputType: "blob" });
  return Buffer.from(await image.arrayBuffer());
}

export async function regeneratePostWithFeedback(input: {
  oldTitle: string;
  oldText: string;
  feedback: string;
  editorialPillar: EditorialPillar;
  ragSystemPrompt?: string;
}): Promise<GeneratedPost> {
  const completion = await getHuggingFaceClient().chatCompletion({
    model: TEXT_MODEL,
    temperature: 0.75,
    max_tokens: 3000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          input.ragSystemPrompt,
          "Voce e um estrategista senior de conteudo B2B para LinkedIn.",
          "Reescreva o post em portugues do Brasil, preservando o pilar editorial e melhorando o resultado conforme o feedback.",
          "Escreva como um engenheiro de dados que viveu o problema: parágrafos curtos, storytelling direto, gramática revisada e sem clichês de IA. Não use 'no mundo dinâmico de hoje', 'revolucionário', 'desvendar', 'desbloquear', 'mergulhar' ou 'alavancar'; evite excesso de hífens e listas corridas.",
          "Retorne somente JSON valido no formato {post:{funnelStage,editorialPillar,formatType,title,textContent,slides}}.",
        ].filter(Boolean).join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          oldPost: { title: input.oldTitle, textContent: input.oldText, editorialPillar: input.editorialPillar },
          feedback: input.feedback,
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
    return parseSingleGeneratedPost(parsed.post ?? parsed, 0);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Nao foi possivel interpretar o JSON da reformulacao.", { cause: error });
    }
    throw error;
  }
}

export const huggingFaceModels = { text: TEXT_MODEL, image: IMAGE_MODEL } as const;
