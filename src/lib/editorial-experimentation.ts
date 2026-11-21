import { EditorialExperimentStatus } from "@prisma/client";

export type ExperimentObservation = {
  postId: string;
  armLabel: string;
  publishedAt: Date | string | null;
  language: string;
  formatType: string;
  pillar: string;
  topic: string | null;
  measurementWindow: string;
  capturedAt: Date | string;
  source: string;
  availability: string;
  impressions: number | null;
  membersReached: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  postSaves: number | null;
  profileViewsFromContent: number | null;
  outOfNetworkPercent: number | null;
  interactionRate: number | null;
};

export const EDITORIAL_METRICS = [
  "impressions", "membersReached", "reactions", "comments", "shares", "postSaves",
  "profileViewsFromContent", "outOfNetworkPercent", "interactionRate",
] as const;
export type EditorialMetric = (typeof EDITORIAL_METRICS)[number];
export type ExposureWindow = "24H" | "72H" | "7D" | "LIFETIME";

export function validateFixedEditorialDistribution(postsPerWeek: number, distribution: Record<string, unknown>): boolean {
  const sum = Object.values(distribution).reduce<number>((total, value) => total + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0);
  const en = distribution["en-US"] ?? distribution.en ?? 0;
  const pt = distribution["pt-BR"] ?? distribution.pt ?? 0;
  return postsPerWeek === 4 && sum === 4 && en === 2 && pt === 2;
}

export function validateOutcomeAssociation(input: { origin: string; association: string; postId: string | null; networkingActivityId: string | null; evidenceNote: string | null }): string | null {
  if (input.origin === "POST_CONFIRMED" && (!input.postId || input.association !== "CONFIRMED")) return "Origem POST_CONFIRMED exige publicação vinculada e associação CONFIRMED.";
  if (input.origin === "NETWORKING_CONFIRMED" && (!input.networkingActivityId || input.association !== "CONFIRMED")) return "Origem NETWORKING_CONFIRMED exige atividade vinculada e associação CONFIRMED.";
  if ((input.origin === "POST_CONFIRMED" || input.origin === "NETWORKING_CONFIRMED") && !input.evidenceNote) return "Registre a evidência que confirma a origem antes de salvar esse vínculo.";
  if (input.association === "HYPOTHESIS" && !input.postId && !input.networkingActivityId) return "Uma hipótese de associação exige indicar a publicação ou atividade relacionada.";
  if (input.origin !== "POST_CONFIRMED" && input.origin !== "NETWORKING_CONFIRMED" && input.association === "CONFIRMED" && !input.postId && !input.networkingActivityId) return "Uma associação confirmada exige publicação ou atividade relacionada.";
  return null;
}

export function buildWeeklyEditorialTimeline(input: {
  posts: Array<{ postId: string; publishedAt: Date | string; impressions: number | null; membersReached: number | null; profileViewsFromContent: number | null; outOfNetworkPercent: number | null; window: string }>;
  activities: Array<{ occurredAt: Date | string; type: string; publicationConfirmed: boolean; newRelevantConnection: boolean; conversationStarted: boolean }>;
  outcomes: Array<{ occurredAt: Date | string; type: string; origin: string; association: string }>;
}) {
  const weekStartBrt = (value: Date | string) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "1970";
    const localDate = new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))));
    const weekday = localDate.getUTCDay() || 7;
    localDate.setUTCDate(localDate.getUTCDate() - weekday + 1);
    return localDate.toISOString().slice(0, 10);
  };
  const weeks = new Map<string, { posts: typeof input.posts; activities: typeof input.activities; outcomes: typeof input.outcomes }>();
  const ensure = (date: Date | string) => {
    const key = weekStartBrt(date);
    if (!weeks.has(key)) weeks.set(key, { posts: [], activities: [], outcomes: [] });
    return weeks.get(key)!;
  };
  for (const post of input.posts) ensure(post.publishedAt).posts.push(post);
  for (const activity of input.activities) ensure(activity.occurredAt).activities.push(activity);
  for (const outcome of input.outcomes) ensure(outcome.occurredAt).outcomes.push(outcome);
  const average = (values: Array<number | null>) => { const known = values.filter((value): value is number => value !== null && Number.isFinite(value)); return known.length ? Number((known.reduce((a, b) => a + b, 0) / known.length).toFixed(2)) : null; };
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, data]) => {
    const measured = data.posts.filter((post) => post.window === "7D");
    return {
      weekStartBrt: weekStart,
      publishedPosts: data.posts.length,
      postsWith7dSnapshot: measured.length,
      averageImpressionsPerPost: average(measured.map((post) => post.impressions)),
      averageReachPerPost: average(measured.map((post) => post.membersReached)),
      averageProfileViewsFromPost: average(measured.map((post) => post.profileViewsFromContent)),
      averageOutOfNetworkPercent: average(measured.map((post) => post.outOfNetworkPercent)),
      networkingActivities: data.activities.length,
      manuallyConfirmedComments: data.activities.filter((activity) => activity.type === "COMMENT_PUBLISHED" && activity.publicationConfirmed).length,
      relevantConnections: data.activities.filter((activity) => activity.newRelevantConnection).length,
      conversationsStarted: data.activities.filter((activity) => activity.conversationStarted).length,
      careerOutcomes: data.outcomes.length,
      recruiterContacts: data.outcomes.filter((outcome) => outcome.type === "RECRUITER_CONTACT").length,
      interviews: data.outcomes.filter((outcome) => outcome.type === "INTERVIEW_INVITATION").length,
      postConfirmedOutcomes: data.outcomes.filter((outcome) => outcome.origin === "POST_CONFIRMED" && outcome.association === "CONFIRMED").length,
    };
  });
}

const asMillis = (value: Date | string): number => new Date(value).getTime();
const mean = (values: number[]) => values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Number((sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2).toFixed(2));
};

export function summarizeExperiment(input: {
  observations: ExperimentObservation[];
  metric: EditorialMetric;
  window: ExposureWindow;
  minimumObservations: number;
  startsAt: Date;
  endsAt: Date;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const latestByPost = new Map<string, ExperimentObservation>();
  for (const row of input.observations) {
    if (row.measurementWindow !== input.window || !["AVAILABLE", "PARTIAL"].includes(row.availability)) continue;
    if (!row.publishedAt || asMillis(row.publishedAt) < input.startsAt.getTime() || asMillis(row.publishedAt) > input.endsAt.getTime()) continue;
    const value = row[input.metric];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const current = latestByPost.get(row.postId);
    if (!current || asMillis(row.capturedAt) > asMillis(current.capturedAt)) latestByPost.set(row.postId, row);
  }
  const arms = new Map<string, number[]>();
  const postsByArm = new Map<string, string[]>();
  const sourcesByArm = new Map<string, Set<string>>();
  for (const row of latestByPost.values()) {
    const values = arms.get(row.armLabel) ?? [];
    values.push(row[input.metric]!);
    arms.set(row.armLabel, values);
    const posts = postsByArm.get(row.armLabel) ?? [];
    posts.push(row.postId);
    postsByArm.set(row.armLabel, posts);
    const sources = sourcesByArm.get(row.armLabel) ?? new Set<string>();
    sources.add(row.source);
    sourcesByArm.set(row.armLabel, sources);
  }
  const groups = [...arms.entries()].map(([label, values]) => ({ label, n: values.length, mean: mean(values), median: median(values), postIds: postsByArm.get(label) ?? [], sources: [...(sourcesByArm.get(label) ?? [])].sort() }));
  const enough = groups.length >= 2 && groups.every((group) => group.n >= input.minimumObservations);
  const ended = input.endsAt.getTime() < now.getTime();
  const status: EditorialExperimentStatus = enough
    ? (ended ? EditorialExperimentStatus.READY_FOR_REVIEW : now >= input.startsAt ? EditorialExperimentStatus.RUNNING : EditorialExperimentStatus.PLANNED)
    : (ended ? EditorialExperimentStatus.INSUFFICIENT_DATA : now >= input.startsAt ? EditorialExperimentStatus.RUNNING : EditorialExperimentStatus.PLANNED);
  const hasComparableData = enough && groups.every((group) => group.mean !== null);
  return {
    status,
    metric: input.metric,
    measurementWindow: input.window,
    sampleSize: [...latestByPost.keys()].length,
    minimumObservationsPerArm: input.minimumObservations,
    coverage: groups,
    comparison: hasComparableData ? {
      highestObservedArm: [...groups].sort((a, b) => (b.mean ?? -Infinity) - (a.mean ?? -Infinity))[0]?.label ?? null,
      lowestObservedArm: [...groups].sort((a, b) => (a.mean ?? Infinity) - (b.mean ?? Infinity))[0]?.label ?? null,
      note: "Comparação descritiva entre observações; não demonstra causalidade nem significância estatística.",
    } : null,
    limitations: [
      "Apenas uma observação por publicação e janela é usada (snapshot mais recente).",
      "Métricas ausentes permanecem ausentes e não são convertidas em zero.",
      "Posts e contextos editoriais podem diferir além da variável testada.",
      ...(groups.length < 2 ? ["São necessários ao menos dois braços com dados observados."] : []),
      ...groups.filter((group) => group.n < input.minimumObservations).map((group) => `Amostra insuficiente em ${group.label}: n=${group.n}, mínimo=${input.minimumObservations}.`),
    ],
  };
}

export type RecommendationCandidate = {
  dimension: string;
  value: string;
  metric: EditorialMetric;
  window: ExposureWindow;
  periodStart: Date;
  periodEnd: Date;
  selected: { n: number; mean: number; postIds?: string[] };
  comparison: { n: number; mean: number; postIds?: string[] };
  sources?: string[];
};

export function buildRecommendationCandidate(input: RecommendationCandidate) {
  const selectedDelta = input.comparison.mean === 0 ? null : Number(((input.selected.mean - input.comparison.mean) / Math.abs(input.comparison.mean) * 100).toFixed(1));
  const direction = input.selected.mean >= input.comparison.mean ? "acima" : "abaixo";
  const sampleSize = input.selected.n + input.comparison.n;
  return {
    recommendationKey: [input.dimension, input.value, input.metric, input.window, input.periodStart.toISOString().slice(0, 10), input.periodEnd.toISOString().slice(0, 10)].join(":"),
    title: `Avaliar ${input.dimension}: ${input.value}`,
    diagnosis: `No período observado, ${input.value} ficou ${direction} do grupo comparador em ${input.metric} (${input.window}).`,
    dataSnapshot: { dimension: input.dimension, value: input.value, metric: input.metric, window: input.window, selected: input.selected, comparison: input.comparison, sources: input.sources ?? [], relativeDifferencePercent: selectedDelta, method: "arithmetic-mean-of-latest-per-post-snapshot" },
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    sampleSize,
    hypothesis: `Testar se ${input.dimension}=${input.value} está associado a diferenças em ${input.metric}, mantendo comparabilidade editorial nas próximas observações.`,
    justification: `Média observada: ${input.selected.mean} (n=${input.selected.n}) versus ${input.comparison.mean} (n=${input.comparison.n}); diferença relativa ${selectedDelta === null ? "indisponível" : `${selectedDelta}%`}. Fontes: ${(input.sources ?? []).join(", ") || "n/d"}. Associação descritiva, sem inferência causal.`,
    confidence: Math.min(input.selected.n, input.comparison.n) >= 6 ? "MEDIUM" : "LOW",
    nextAction: "Planejar uma comparação controlada e manter a frequência e distribuição de idiomas aprovadas até revisão humana.",
    limitations: ["Dados observacionais não provam causalidade.", "A comparação pode conter diferenças de tema, audiência, horário e contexto.", "A média não é uma previsão de desempenho futuro."],
  };
}

export function cyclePhase(startDate: Date, now = new Date()): "BASELINE" | "EXPERIMENTATION" | "CONSOLIDATION" | "NOT_STARTED" | "COMPLETE" {
  const elapsedDays = Math.floor((now.getTime() - startDate.getTime()) / 86_400_000);
  if (elapsedDays < 0) return "NOT_STARTED";
  if (elapsedDays < 30) return "BASELINE";
  if (elapsedDays < 60) return "EXPERIMENTATION";
  if (elapsedDays < 90) return "CONSOLIDATION";
  return "COMPLETE";
}
