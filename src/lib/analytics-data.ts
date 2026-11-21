export const POST_METRIC_FIELDS = {
  IMPRESSION: "impressions",
  MEMBERS_REACHED: "membersReached",
  REACTION: "reactions",
  COMMENT: "comments",
  RESHARE: "shares",
  POST_SAVE: "postSaves",
  POST_SEND: "postSends",
  LINK_CLICKS: "linkClicks",
  PREMIUM_CTA_CLICKS: "premiumCtaClicks",
  FOLLOWER_GAINED_FROM_CONTENT: "followersGained",
  PROFILE_VIEW_FROM_CONTENT: "profileViewsFromContent",
} as const;

export const PROFILE_METRIC_TYPES = [
  "PROFILE_VIEWS", "FOLLOWERS", "SEARCH_APPEARANCES",
  "IMPRESSIONS_IN_NETWORK", "IMPRESSIONS_IN_NETWORK_PERCENT",
  "IMPRESSIONS_OUTSIDE_NETWORK", "IMPRESSIONS_OUTSIDE_NETWORK_PERCENT",
  "MEMBERS_REACHED_IN_NETWORK", "MEMBERS_REACHED_OUTSIDE_NETWORK",
] as const;

export function isValidProfileMetricValue(metricType: string, value: number | null): boolean {
  if (value === null || !Number.isSafeInteger(value) || value < 0) return false;
  return !metricType.endsWith("_PERCENT") || value <= 100;
}

export type PostMetricField = (typeof POST_METRIC_FIELDS)[keyof typeof POST_METRIC_FIELDS];
export type MetricValues = Partial<Record<PostMetricField, number | null>>;

export function parseOptionalNonNegativeInteger(value: unknown): { valid: boolean; value: number | null } {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return { valid: true, value: null };
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return { valid: false, value: null };
  return { valid: true, value: parsed };
}

export function observedInteractionRate(values: Pick<MetricValues, "impressions" | "reactions" | "comments" | "shares">): number | null {
  const { impressions, reactions, comments, shares } = values;
  if (impressions === null || impressions === undefined || impressions <= 0
    || reactions === null || reactions === undefined
    || comments === null || comments === undefined
    || shares === null || shares === undefined) return null;
  return Number((((reactions + comments + shares) / impressions) * 100).toFixed(3));
}

export type MeasurementWindow = "24H" | "72H" | "7D";
export function measurementWindowLateness(window: string, exposureHours: number): number | null {
  const target = window === "24H" ? 24 : window === "72H" ? 72 : window === "7D" ? 168 : null;
  if (target === null || !Number.isFinite(exposureHours)) return null;
  return Number(Math.max(0, exposureHours - target).toFixed(2));
}

const WINDOW_HOURS: ReadonlyArray<{ window: MeasurementWindow; hours: number }> = [
  { window: "24H", hours: 24 },
  { window: "72H", hours: 72 },
  { window: "7D", hours: 168 },
];

export function nextDueMeasurementWindow(ageHours: number, alreadyCaptured: ReadonlySet<string>): MeasurementWindow | null {
  return WINDOW_HOURS.find(({ window, hours }) => ageHours >= hours && !alreadyCaptured.has(window))?.window ?? null;
}

export function snapshotIdempotencyKey(postId: string, source: string, window: string, capturedAt: Date): string {
  return [postId, source, window, capturedAt.toISOString().slice(0, 10)].join(":");
}

export function metricAvailability(values: MetricValues): "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" {
  const expected = Object.keys(POST_METRIC_FIELDS).map((key) => POST_METRIC_FIELDS[key as keyof typeof POST_METRIC_FIELDS]);
  return metricAvailabilityForFields(values, expected);
}

export function metricAvailabilityForFields(values: Record<string, number | null>, expectedFields: readonly string[]): "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" {
  const fields = expectedFields.filter((field) => Object.hasOwn(values, field));
  const availableCount = fields.filter((field) => values[field] !== null && values[field] !== undefined).length;
  if (availableCount === 0) return "UNAVAILABLE";
  return availableCount === fields.length ? "AVAILABLE" : "PARTIAL";
}
