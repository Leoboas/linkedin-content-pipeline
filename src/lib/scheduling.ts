import type { EditorialPillar } from "@prisma/client";
import { DEFAULT_WEEKLY_SCHEDULE, normalizeWeeklySchedule, scheduledDateForEditorialSlot, type EditorialScheduleSlot } from "./editorial-calendar.ts";
import { formatDateTimeLocalInBrazil, parseDateTimeLocalInBrazil } from "./dates.ts";

const pillarOffsets: Record<EditorialPillar, number> = {
  TOFU: 0,
  MOFU: 2,
  BOFU: 4,
};

export function getPipelineBaseDate(referenceDate = new Date()): Date {
  if (Number.isNaN(referenceDate.getTime())) throw new Error("referenceDate invalida.");

  const localDate = formatDateTimeLocalInBrazil(referenceDate).slice(0, 10);
  const baseDate = parseDateTimeLocalInBrazil(`${localDate}T00:00`);
  const daysSinceMonday = (baseDate.getUTCDay() + 6) % 7;
  baseDate.setUTCDate(baseDate.getUTCDate() - daysSinceMonday);
  return baseDate;
}

/**
 * Returns the next Monday that still has a complete TOFU/MOFU/BOFU cadence.
 * The weekly cron runs on Sunday, so using the current week's Monday would
 * create a batch whose first publication window is already in the past.
 */
export function getNextPipelineBaseDate(referenceDate = new Date()): Date {
  const baseDate = getPipelineBaseDate(referenceDate);
  if (scheduledDateForEditorialSlot(baseDate, DEFAULT_WEEKLY_SCHEDULE[0]) <= referenceDate) {
    baseDate.setUTCDate(baseDate.getUTCDate() + 7);
  }
  return baseDate;
}

export function scheduledDateForPillar(
  pillar: EditorialPillar,
  baseDate = getPipelineBaseDate(),
): Date {
  const slotIndex = pillar === "TOFU" ? 0 : pillar === "MOFU" ? 1 : 2;
  return scheduledDateForEditorialSlot(baseDate, DEFAULT_WEEKLY_SCHEDULE[slotIndex]);
}

export function scheduledDateForPost(
  index: number,
  pillar: EditorialPillar,
  baseDate: Date,
  scheduleInput: unknown = DEFAULT_WEEKLY_SCHEDULE,
): Date {
  const schedule = normalizeWeeklySchedule(scheduleInput);
  const slot = schedule[index];
  if (!slot) return scheduledDateForPillar(pillar, baseDate);
  return scheduledDateForEditorialSlot(baseDate, slot);
}

/** Rolling schedule used for a manual reset: starts today and never backfills past slots. */
export function rollingScheduledDateForPost(index: number, pillar: EditorialPillar, startAt: Date): Date {
  if (Number.isNaN(startAt.getTime())) throw new Error("startAt invalido.");
  if (index < 0 || index > 3) throw new Error("Índice de slot fora do calendário semanal.");
  void pillar;
  const candidates: Date[] = [];
  let monday = getPipelineBaseDate(startAt);
  for (let week = 0; week < 4 && candidates.length <= index; week += 1) {
    for (const slot of DEFAULT_WEEKLY_SCHEDULE) {
      const candidate = scheduledDateForEditorialSlot(monday, slot);
      if (candidate > startAt) candidates.push(candidate);
    }
    monday = new Date(monday.getTime() + 7 * 86400000);
  }
  const scheduled = candidates[index];
  if (!scheduled) throw new Error("Não foi encontrado um slot editorial futuro.");
  return scheduled;
}

export function editorialSlot(index: number): { pillar: EditorialPillar; hour: string; weekday: number } {
  const slot: EditorialScheduleSlot = DEFAULT_WEEKLY_SCHEDULE[index] ?? DEFAULT_WEEKLY_SCHEDULE[DEFAULT_WEEKLY_SCHEDULE.length - 1];
  const pillars: EditorialPillar[] = ["TOFU", "MOFU", "BOFU", "TOFU"];
  return { pillar: pillars[index] ?? "TOFU", hour: slot.localTime, weekday: slot.weekday };
}

export function pillarOrder(pillar: EditorialPillar): number {
  return pillarOffsets[pillar];
}
