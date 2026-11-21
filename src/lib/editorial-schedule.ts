import type { ContentLanguage } from "@/lib/language-planner";

export type EditorialObjective = "Discovery" | "Authority" | "Proof" | "Career Conversion";

export interface EditorialScheduleSlot {
  /** ISO weekday: Monday=1, Sunday=7. */
  dayOfWeek: number;
  /** Local wall-clock time in America/Sao_Paulo, HH:mm. */
  time: string;
  objective: EditorialObjective;
}
export const DEFAULT_WEEKLY_SCHEDULE: readonly EditorialScheduleSlot[] = [
  { dayOfWeek: 1, time: "13:00", objective: "Discovery" },
  { dayOfWeek: 2, time: "16:00", objective: "Authority" },
  { dayOfWeek: 4, time: "13:00", objective: "Proof" },
  { dayOfWeek: 5, time: "16:00", objective: "Career Conversion" },
];

export const EDITORIAL_WEEKDAYS = [
  { value: 1, label: "Segunda-feira" },
  { value: 2, label: "Terça-feira" },
  { value: 3, label: "Quarta-feira" },
  { value: 4, label: "Quinta-feira" },
  { value: 5, label: "Sexta-feira" },
  { value: 6, label: "Sábado" },
  { value: 7, label: "Domingo" },
] as const;

function isObjective(value: unknown): value is EditorialObjective {
  return value === "Discovery" || value === "Authority" || value === "Proof" || value === "Career Conversion";
}

export function normalizeWeeklySchedule(value: unknown, count = 4): EditorialScheduleSlot[] {
  const boundedCount = Math.max(1, Math.min(4, Math.floor(count)));
  const source = Array.isArray(value) ? value : [];
  const normalized = source.flatMap((item): EditorialScheduleSlot[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (!Number.isInteger(row.dayOfWeek) || Number(row.dayOfWeek) < 1 || Number(row.dayOfWeek) > 7) return [];
    if (typeof row.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(row.time) || !isObjective(row.objective)) return [];
    return [{ dayOfWeek: Number(row.dayOfWeek), time: row.time, objective: row.objective }];
  });
  const valid = normalized.length >= boundedCount
    && new Set(normalized.map((slot) => slot.dayOfWeek)).size === normalized.length;
  return (valid ? normalized : [...DEFAULT_WEEKLY_SCHEDULE]).slice(0, boundedCount);
}

export function isValidWeeklySchedule(value: unknown, count = 4): value is EditorialScheduleSlot[] {
  if (!Array.isArray(value) || value.length !== count || count < 1 || count > 4) return false;
  const normalized = normalizeWeeklySchedule(value, count);
  if (normalized.length !== value.length) return false;
  // In phase 1 the calendar days/objectives are the approved baseline; admins may edit times.
  return normalized.every((slot, index) =>
    slot.dayOfWeek === DEFAULT_WEEKLY_SCHEDULE[index]?.dayOfWeek
    && slot.objective === DEFAULT_WEEKLY_SCHEDULE[index]?.objective,
  );
}

export function scheduledLanguageForSlot(index: number, languages: ContentLanguage[]): ContentLanguage {
  return languages[index] ?? "pt-BR";
}
