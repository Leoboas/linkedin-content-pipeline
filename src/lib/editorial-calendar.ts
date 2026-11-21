import type { ContentLanguage } from "@/lib/language-planner";
import { formatDateTimeLocalInBrazil, parseDateTimeLocalInBrazil } from "@/lib/dates";

export type EditorialObjective = "Discovery" | "Authority" | "Proof" | "Career Conversion";
export type EditorialWeekday = 1 | 2 | 4 | 5;

export interface EditorialScheduleSlot {
  weekday: EditorialWeekday;
  localTime: string;
  language: ContentLanguage;
  objective: EditorialObjective;
}

export const DEFAULT_WEEKLY_SCHEDULE: EditorialScheduleSlot[] = [
  { weekday: 1, localTime: "13:00", language: "en-US", objective: "Discovery" },
  { weekday: 2, localTime: "16:00", language: "pt-BR", objective: "Authority" },
  { weekday: 4, localTime: "13:00", language: "en-US", objective: "Proof" },
  { weekday: 5, localTime: "16:00", language: "pt-BR", objective: "Career Conversion" },
];

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export function normalizeWeeklySchedule(value: unknown): EditorialScheduleSlot[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_WEEKLY_SCHEDULE.length) return DEFAULT_WEEKLY_SCHEDULE.map((slot) => ({ ...slot }));
  const parsed: EditorialScheduleSlot[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return DEFAULT_WEEKLY_SCHEDULE.map((slot) => ({ ...slot }));
    const record = item as Record<string, unknown>;
    const canonical = DEFAULT_WEEKLY_SCHEDULE[index];
    if (record.weekday !== canonical.weekday || record.language !== canonical.language || record.objective !== canonical.objective
      || typeof record.localTime !== "string" || !timePattern.test(record.localTime)) {
      return DEFAULT_WEEKLY_SCHEDULE.map((slot) => ({ ...slot }));
    }
    parsed.push({ ...canonical, localTime: record.localTime });
  }
  return parsed;
}

export function isValidWeeklySchedule(value: unknown): value is EditorialScheduleSlot[] {
  return Array.isArray(value) && value.length === DEFAULT_WEEKLY_SCHEDULE.length
    && value.every((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const record = item as Record<string, unknown>;
      const canonical = DEFAULT_WEEKLY_SCHEDULE[index];
      return record.weekday === canonical.weekday && record.language === canonical.language
        && record.objective === canonical.objective && typeof record.localTime === "string" && timePattern.test(record.localTime);
    });
}

/** Convert a local Sao Paulo wall-clock slot into a UTC instant, independent of host timezone. */
export function scheduledDateForEditorialSlot(baseDate: Date, slot: EditorialScheduleSlot): Date {
  if (Number.isNaN(baseDate.getTime())) throw new Error("Data-base inválida para o calendário editorial.");
  const localDate = formatDateTimeLocalInBrazil(baseDate).slice(0, 10);
  const localMidnight = parseDateTimeLocalInBrazil(`${localDate}T00:00`);
  const weekday = localMidnight.getUTCDay() || 7;
  localMidnight.setUTCDate(localMidnight.getUTCDate() + slot.weekday - weekday);
  const targetDate = formatDateTimeLocalInBrazil(localMidnight).slice(0, 10);
  return parseDateTimeLocalInBrazil(`${targetDate}T${slot.localTime}`);
}
