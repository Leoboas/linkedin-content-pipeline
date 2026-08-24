import type { EditorialPillar } from "@prisma/client";
import { getOptimalPostingTime } from "@/lib/dates";

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
