export type ContentLanguage = "pt-BR" | "en-US";
export type LanguageDistribution = Record<ContentLanguage, number>;

export const DEFAULT_LANGUAGE_DISTRIBUTION: LanguageDistribution = { "pt-BR": 2, "en-US": 2 };

export function defaultLanguageDistribution(postsPerWeek: number): LanguageDistribution {
  const count = Number.isInteger(postsPerWeek) && postsPerWeek > 0 ? Math.min(postsPerWeek, 4) : 4;
  const english = Math.ceil(count / 2);
  return { "pt-BR": count - english, "en-US": english };
}

export function normalizeLanguageDistribution(value: unknown, postsPerWeek = 4): LanguageDistribution {
  const count = Number.isInteger(postsPerWeek) && postsPerWeek > 0 ? postsPerWeek : 4;
  const fallback = defaultLanguageDistribution(count);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  const pt = Number(record["pt-BR"]);
  const en = Number(record["en-US"]);
  if (!Number.isInteger(pt) || pt < 0 || !Number.isInteger(en) || en < 0 || pt + en !== count) return fallback;
  return { "pt-BR": pt, "en-US": en };
}

export function isValidLanguageDistribution(value: unknown, postsPerWeek: number): value is LanguageDistribution {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isInteger(postsPerWeek) || postsPerWeek < 1) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 2
    && keys.every((key) => key === "pt-BR" || key === "en-US")
    && Number.isInteger(record["pt-BR"]) && Number(record["pt-BR"]) >= 0
    && Number.isInteger(record["en-US"]) && Number(record["en-US"]) >= 0
    && Number(record["pt-BR"]) + Number(record["en-US"]) === postsPerWeek;
}

/** Distributes configured locales across calendar slots, starting in English on ties. */
export function planLanguages(count: number, distributionInput: unknown): ContentLanguage[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  const distribution = normalizeLanguageDistribution(distributionInput, count);
  const ptCount = distribution["pt-BR"];
  const enCount = distribution["en-US"];
  const result: ContentLanguage[] = [];
  let ptRemaining = ptCount;
  let enRemaining = enCount;
  while (ptRemaining + enRemaining > 0) {
    const previous = result.at(-1);
    const ptRatio = ptCount === 0 ? -1 : ptRemaining / ptCount;
    const enRatio = enCount === 0 ? -1 : enRemaining / enCount;
    const choosePt = ptRemaining > 0 && (enRemaining === 0 || (previous !== "pt-BR" && ptRatio > enRatio));
    if (choosePt) { result.push("pt-BR"); ptRemaining -= 1; }
    else { result.push("en-US"); enRemaining -= 1; }
  }
  return result;
}
