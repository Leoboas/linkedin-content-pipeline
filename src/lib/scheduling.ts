import type { EditorialPillar } from "@prisma/client";
import { getOptimalPostingTime } from "./dates.ts";

const pillarOffsets: Record<EditorialPillar, number> = {
  TOFU: 0,
  MOFU: 2,
  BOFU: 4,
};

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
  if (index < 3) return scheduledDateForPillar((["TOFU", "MOFU", "BOFU"] as const)[index], baseDate);
  return scheduledDateForPillar(pillar, baseDate);
}

export function pillarOrder(pillar: EditorialPillar): number {
  return pillarOffsets[pillar];
}
