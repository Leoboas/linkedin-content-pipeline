import type { EditorialPillar } from "@prisma/client";
import { formatDateTimeLocalInBrazil, getOptimalPostingTime, parseDateTimeLocalInBrazil } from "./dates.ts";

const pillarOffsets: Record<EditorialPillar, number> = {
  TOFU: 0,
  MOFU: 2,
  BOFU: 4,
};

const weeklySlots: Array<{ dayOffset: number; hour: number; minute: number; pillar: EditorialPillar }> = [
  { dayOffset: 0, hour: 8, minute: 30, pillar: "TOFU" },
  { dayOffset: 2, hour: 11, minute: 45, pillar: "MOFU" },
  { dayOffset: 4, hour: 9, minute: 15, pillar: "BOFU" },
  { dayOffset: 7, hour: 8, minute: 30, pillar: "TOFU" },
];

export function getPipelineBaseDate(referenceDate = new Date()): Date {
  if (Number.isNaN(referenceDate.getTime())) throw new Error("referenceDate invalida.");

  const baseDate = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  ));
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
  if (getOptimalPostingTime(baseDate, "TOFU") <= referenceDate) {
    baseDate.setUTCDate(baseDate.getUTCDate() + 7);
  }
  return baseDate;
}

export function scheduledDateForPillar(
  pillar: EditorialPillar,
  baseDate = getPipelineBaseDate(),
): Date {
  return getOptimalPostingTime(baseDate, pillar);
}

export function scheduledDateForPost(index: number, pillar: EditorialPillar, baseDate: Date): Date {
  const slot = weeklySlots[index];
  if (!slot) return scheduledDateForPillar(pillar, baseDate);
  const monday = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate()));
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday + slot.dayOffset);
  monday.setUTCHours(slot.hour + 3, slot.minute, 0, 0);
  return monday;
}

/** Rolling schedule used for a manual reset: starts today and never backfills past slots. */
export function rollingScheduledDateForPost(index: number, pillar: EditorialPillar, startAt: Date): Date {
  if (Number.isNaN(startAt.getTime())) throw new Error("startAt invalido.");
  const startLocal = formatDateTimeLocalInBrazil(new Date(startAt.getTime() + 30 * 60 * 1000));
  const [datePart] = startLocal.split("T");
  const startDate = parseDateTimeLocalInBrazil(datePart + "T00:00");
  let businessDays = 0;
  while (businessDays < index) {
    startDate.setUTCDate(startDate.getUTCDate() + 1);
    const weekday = startDate.getUTCDay();
    if (weekday !== 0 && weekday !== 6) businessDays += 1;
  }
  const hourByPillar: Record<EditorialPillar, string> = { TOFU: "08:30", MOFU: "11:45", BOFU: "09:15" };
  const scheduled = parseDateTimeLocalInBrazil(formatDateTimeLocalInBrazil(startDate).slice(0, 10) + "T" + hourByPillar[pillar]);
  return index === 0 && scheduled <= startAt ? new Date(startAt.getTime() + 30 * 60 * 1000) : scheduled;
}

export function editorialSlot(index: number): { pillar: EditorialPillar; hour: string; weekday: number } {
  const slot = weeklySlots[index] ?? weeklySlots[weeklySlots.length - 1];
  return { pillar: slot.pillar, hour: `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`, weekday: slot.dayOffset + 1 };
}

export function pillarOrder(pillar: EditorialPillar): number {
  return pillarOffsets[pillar];
}
