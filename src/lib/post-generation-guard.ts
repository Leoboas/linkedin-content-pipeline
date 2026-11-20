export function weeklyGenerationKeys(weekKey: string, count: number): string[] {
  const boundedCount = Math.max(0, Math.min(4, Math.floor(count)));
  return Array.from({ length: boundedCount }, (_, index) => `weekly:${weekKey}:slot:${index}`);
}

export interface WeeklyGenerationRecord {
  generationKey: string | null;
  status: string;
  qualityStatus: string | null;
}

export interface WeeklyGenerationSlot {
  slotIndex: number;
  generationKey: string;
}

const terminalWithoutPublication = new Set([
  "ARCHIVED",
  "CANCELLED",
  "REJECTED",
  "REJECTED_PENDING_FEEDBACK",
]);
const approvedOrPublished = new Set([
  "AWAITING_APPROVAL",
  "APPROVED",
  "PUBLISHING",
  "PUBLISHED",
  "REGENERATING",
  "SCHEDULED",
]);

function occupiesWeeklySlot(record: WeeklyGenerationRecord): boolean {
  if (terminalWithoutPublication.has(record.status)) return false;
  if (approvedOrPublished.has(record.status)) return true;
  if (record.status === "DRAFT" && ["NEEDS_REVISION", "BLOCKED"].includes(record.qualityStatus ?? "")) return false;
  // A draft with no failed quality verdict, or an unknown workflow state,
  // remains a claimed slot to avoid duplicate generation.
  return true;
}

/**
 * Finds slots that can be generated without overwriting historical posts.
 * A failed/archived attempt gets a new immutable generation key, bounded to
 * three total attempts per slot (the original plus two retries).
 */
export function getAvailableWeeklySlots(
  weekKey: string,
  count: number,
  records: WeeklyGenerationRecord[],
  maxAttempts = 3,
): WeeklyGenerationSlot[] {
  const baseKeys = weeklyGenerationKeys(weekKey, count);
  return baseKeys.flatMap((baseKey, slotIndex) => {
    const related = records.filter((record) =>
      record.generationKey === baseKey || record.generationKey?.startsWith(`${baseKey}:revision:`),
    );
    if (related.some(occupiesWeeklySlot)) return [];

    const revisions = related.flatMap((record) => {
      if (record.generationKey === baseKey) return [1];
      const match = record.generationKey?.match(/:revision:(\d+)$/u);
      return match ? [Number(match[1])] : [];
    });
    const nextAttempt = revisions.length === 0 ? 1 : Math.max(...revisions) + 1;
    if (nextAttempt > maxAttempts) return [];

    return [{
      slotIndex,
      generationKey: nextAttempt === 1 ? baseKey : `${baseKey}:revision:${nextAttempt}`,
    }];
  });
}

function normalizeTitle(title: string): string {
  return title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeWord(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

export function hasDuplicatePostTitle(candidate: string, existingTitles: string[], threshold = 0.82): boolean {
  const normalized = normalizeTitle(candidate);
  if (!normalized) return false;
  const words = new Set(normalized.split(/\s+/).filter((word) => word.length > 2).map(normalizeWord));
  return existingTitles.some((existing) => {
    const existingNormalized = normalizeTitle(existing);
    if (existingNormalized === normalized) return true;
    const existingWords = new Set(existingNormalized.split(/\s+/).filter((word) => word.length > 2).map(normalizeWord));
    if (words.size < 4 || existingWords.size < 4) return false;
    const intersection = [...words].filter((word) => existingWords.has(word)).length;
    const union = new Set([...words, ...existingWords]).size;
    return union > 0 && intersection / union >= threshold;
  });
}
