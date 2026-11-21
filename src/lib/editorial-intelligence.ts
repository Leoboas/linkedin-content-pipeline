import { FormatType } from "@prisma/client";
import type { CreativeEvidence } from "@/lib/creative-brief";
import type { VisualFormat } from "../../config/creative-direction";

export const CAREER_TARGET_ROLES = [
  "Data Engineer", "Senior Data Engineer", "Python Backend Engineer", "Backend Software Engineer",
  "Data Platform Engineer", "Software Architect", "Technical Lead",
] as const;

export const CAREER_TECHNOLOGIES = [
  "Python", "SQL", "PostgreSQL", "FastAPI", "AWS", "PySpark", "Airflow", "ETL", "ELT",
  "data pipeline", "API", "Docker", "Terraform", "CI/CD", "distributed systems", "observability",
] as const;

export const EDITORIAL_THEMES = [
  "Data Engineering", "Python Backend", "Software Architecture", "Distributed Systems",
  "Reliability & Observability", "Technical Leadership",
] as const;
export type EditorialTheme = typeof EDITORIAL_THEMES[number];

export interface CareerRelevanceResult {
  score: number;
  scale: "0-5";
  breakdown: {
    targetRoleAlignment: number;
    technologyRelevance: number;
    evidenceAvailability: number;
    desiredAudience: number;
    practicalEngineering: number;
  };
  rationale: string[];
}
export interface HookQualityResult {
  score: number;
  scale: "0-100";
  breakdown: {
    clarity: number;
    technicalSpecificity: number;
    recognizableProblem: number;
    concreteConsequence: number;
    originality: number;
    evidenceProximity: number;
  };
  rationale: string[];
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
}

function words(value: string): Set<string> {
  return new Set(normalized(value).match(/[a-z0-9+#.]{2,}/gu) ?? []);
}

function hasAny(text: string, candidates: readonly string[]): boolean {
  const value = normalized(text);
  return candidates.some((candidate) => value.includes(normalized(candidate)));
}

function similarity(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  return intersection / new Set([...a, ...b]).size;
}

export function scoreCareerRelevance(input: {
  title: string;
  textContent: string;
  evidence?: CreativeEvidence[];
}): CareerRelevanceResult {
  const text = `${input.title}\n${input.textContent}`;
  const evidence = (input.evidence ?? []).filter((item) => item.verified && item.kind !== "PLANNED_FEATURE");
  const roleHits = CAREER_TARGET_ROLES.filter((role) => hasAny(text, [role])).length;
  const roleDimension = Math.min(5, roleHits * 2 + (hasAny(text, ["engineer", "engenheiro", "backend", "data platform", "tech lead"]) ? 2 : 0));
  const technologyHits = CAREER_TECHNOLOGIES.filter((technology) => hasAny(text, [technology])).length;
  const technologyDimension = Math.min(5, technologyHits >= 4 ? 5 : technologyHits >= 3 ? 4 : technologyHits >= 2 ? 3 : technologyHits === 1 ? 2 : 0);
  const evidenceDimension = Math.min(5, evidence.length === 0 ? 0 : evidence.some((item) => item.kind === "PORTFOLIO_PROJECT" || item.kind === "PROFESSIONAL_EXPERIENCE") ? Math.min(5, 3 + evidence.length) : 2 + Math.min(2, evidence.length));
  const audienceDimension = Math.min(5, hasAny(text, ["recruiter", "recrutador", "engineering team", "time de engenharia", "data team", "equipe de dados", "technical audience", "profissionais de tecnologia"]) ? 5 : hasAny(text, ["team", "equipe", "production", "produção", "operation", "operação", "business decision"]) ? 3 : 2);
  const practicalSignals = ["trade-off", "tradeoff", "decision", "decisão", "implemented", "implementei", "implementation", "constraint", "constraint", "test", "teste", "failure mode", "falha", "query", "endpoint", "repository", "repositório", "code", "código"];
  const practicalDimension = Math.min(5, practicalSignals.filter((signal) => hasAny(text, [signal])).length >= 4 ? 5 : practicalSignals.filter((signal) => hasAny(text, [signal])).length >= 3 ? 4 : practicalSignals.filter((signal) => hasAny(text, [signal])).length >= 2 ? 3 : practicalSignals.some((signal) => hasAny(text, [signal])) ? 2 : 0);
  const breakdown = { targetRoleAlignment: roleDimension, technologyRelevance: technologyDimension, evidenceAvailability: evidenceDimension, desiredAudience: audienceDimension, practicalEngineering: practicalDimension };
  const score = Math.round(Object.values(breakdown).reduce((sum, value) => sum + value, 0) / 5);
  const rationale = [
    `${roleHits} sinais de aderência a cargos-alvo.`,
    `${technologyHits} tecnologias/temas prioritários identificados.`,
    `${evidence.length} evidência(s) verificável(is) associada(s).`,
    `Engenharia prática e público avaliados por sinais do texto.`,
  ];
  return { score, scale: "0-5", breakdown, rationale };
}

export function evaluateHookQuality(input: {
  title: string;
  textContent: string;
  evidence?: CreativeEvidence[];
  recentTitles?: string[];
}): HookQualityResult {
  const title = input.title.trim();
  const firstTwoLines = input.textContent.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(0, 2).join(" ");
  const hookText = `${title} ${firstTwoLines}`;
  const evidenceText = (input.evidence ?? []).filter((item) => item.verified).map((item) => item.claim).join(" ");
  const specificityWords = words(hookText);
  const techHits = CAREER_TECHNOLOGIES.filter((technology) => hasAny(hookText, [technology])).length;
  const overlapWithEvidence = [...words(title)].filter((word) => words(evidenceText).has(word)).length;
  const tooSimilar = (input.recentTitles ?? []).some((recent) => similarity(title, recent) >= 0.65);
  const breakdown = {
    clarity: title.length >= 22 && title.length <= 95 ? 4 : title.length > 0 ? 2 : 0,
    technicalSpecificity: Math.min(5, techHits >= 2 ? 5 : techHits === 1 ? 4 : specificityWords.size >= 8 ? 3 : 1),
    recognizableProblem: hasAny(hookText, ["problema", "falha", "atras", "delay", "failure", "wrong", "errado", "missing", "duplic", "latency", "stale", "conflito", "risco"]) ? 5 : /[?]/u.test(hookText) ? 3 : 2,
    concreteConsequence: hasAny(hookText, ["custo", "custo", "perda", "atras", "late", "risk", "risco", "downtime", "duplic", "incidente", "impact", "decisão", "decision"]) ? 5 : 2,
    originality: tooSimilar ? 1 : 4,
    evidenceProximity: overlapWithEvidence >= 3 ? 5 : overlapWithEvidence > 0 ? 3 : (input.evidence?.some((item) => item.verified) ? 2 : 1),
  };
  const sum = Object.values(breakdown).reduce((total, value) => total + value, 0);
  const rationale = [
    `Abertura com ${firstTwoLines.length} caracteres nas duas primeiras linhas.`,
    techHits > 0 ? `${techHits} sinal(is) técnico(s) no gancho.` : "Gancho sem tecnologia explícita; pode funcionar se o problema estiver claro.",
    tooSimilar ? "Estrutura semelhante a um título recente." : "Sem similaridade alta com os títulos recentes fornecidos.",
    overlapWithEvidence > 0 ? "A evidência aparece semanticamente próxima da abertura." : "A abertura não reutiliza diretamente termos da evidência; revisar se fizer afirmação factual.",
  ];
  return { score: Math.round(sum / 30 * 100), scale: "0-100", breakdown, rationale };
}

export function classifyEditorialTheme(title: string, textContent: string): EditorialTheme {
  const text = normalized(`${title} ${textContent}`);
  const rules: Array<{ theme: EditorialTheme; terms: string[] }> = [
    { theme: "Data Engineering", terms: ["etl", "elt", "data pipeline", "data engineering", "engenharia de dados", "data quality", "data freshness", "airflow", "pyspark"] },
    { theme: "Python Backend", terms: ["python", "fastapi", "backend", "api", "endpoint", "sqlalchemy"] },
    { theme: "Distributed Systems", terms: ["distributed", "distribuido", "queue", "fila", "async", "assíncrono", "idempot", "retry", "event-driven"] },
    { theme: "Reliability & Observability", terms: ["observability", "observabilidade", "reliability", "confiabilidade", "monitoring", "monitoramento", "incident", "incidente", "latency", "latencia"] },
    { theme: "Software Architecture", terms: ["architecture", "arquitetura", "clean architecture", "ddd", "system design", "multi-tenant", "database", "postgresql", "schema"] },
    { theme: "Technical Leadership", terms: ["technical leadership", "lideranca tecnica", "engineering team", "time de engenharia", "review", "code review", "decisao tecnica"] },
  ];
  const ranked = rules.map((rule) => ({ ...rule, score: rule.terms.filter((term) => text.includes(normalized(term))).length }));
  return ranked.sort((a, b) => b.score - a.score)[0]?.score ? ranked.sort((a, b) => b.score - a.score)[0].theme : "Software Architecture";
}

export function editorialObjectiveForSlot(slotIndex: number): string {
  return ["Discovery", "Authority", "Proof", "Career Conversion"][slotIndex] ?? "Authority";
}

function hasNarrativeProgression(slides: Array<{ title: string; bullets: string[]; code?: string }>): boolean {
  if (slides.length < 3 || slides.length > 7) return false;
  const signatures = slides.map((slide) => `${slide.title} ${slide.bullets.join(" ")} ${slide.code ?? ""}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  if (new Set(signatures).size !== slides.length) return false;
  const tokens = signatures.map((signature) => new Set(signature.split(/\s+/u).filter((word) => word.length > 3)));
  const overlaps: number[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const shared = [...tokens[index - 1]].filter((word) => tokens[index].has(word)).length;
    overlaps.push(shared / Math.max(tokens[index - 1].size, tokens[index].size, 1));
  }
  const progression = slides.some((slide, index) => /^(?:0?[1-9]|[1-7])\b/u.test(slide.title.trim()) || /problema|causa|decis|implement|resultado|trade.?off|problem|decision|implementation|result|trade.?off/i.test(slide.title + " " + slide.bullets.join(" ")));
  return progression && overlaps.every((overlap) => overlap < 0.8);
}

export function selectEditorialFormat(input: {
  requestedFormat: FormatType;
  title: string;
  textContent: string;
  slides: Array<{ title: string; bullets: string[]; code?: string }>;
}): { formatType: FormatType; visualFormat: VisualFormat; reason: string } {
  const text = `${input.title}\n${input.textContent}`;
  if (input.requestedFormat === FormatType.CAROUSEL_PDF && hasNarrativeProgression(input.slides)) {
    return { formatType: FormatType.CAROUSEL_PDF, visualFormat: "carousel-slide", reason: "Narrativa com múltiplas etapas distintas validada." };
  }
  if (input.slides.some((slide) => Boolean(slide.code)) || /\b(select|insert|create table|def |async def|class )\b/iu.test(text)) {
    return { formatType: FormatType.SINGLE_IMAGE, visualFormat: "code-focused", reason: "Conteúdo técnico beneficia-se de trecho tipográfico curto e legível." };
  }
  if (/architecture|arquitetura|data flow|fluxo de dados|pipeline|dependency|depend[eê]ncia|sequence|sequ[eê]ncia|system design/iu.test(text)) {
    return { formatType: FormatType.SINGLE_IMAGE, visualFormat: "architecture-infographic", reason: "O conceito pode ser explicado por um diagrama único baseado no conteúdo." };
  }
  if (/leadership|lideran[cç]a|trade.?off|decision|decis[aã]o|lesson|aprendizado/iu.test(text)) {
    return { formatType: FormatType.TEXT_ONLY, visualFormat: "text-first", reason: "A ideia é argumentativa; o texto é mais claro sem arte decorativa." };
  }
  return { formatType: FormatType.SINGLE_IMAGE, visualFormat: "editorial-illustration", reason: "Uma ilustração editorial única acrescenta contexto sem inventar componentes." };
}
