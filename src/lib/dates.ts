import type { EditorialPillar } from "@prisma/client";

// Horarios definidos em BrasÃ­lia (UTC-3), convertidos para UTC para o Prisma.
const peakSchedule: Record<EditorialPillar, { dayOffset: number; hour: number; minute: number }> = {
  TOFU: { dayOffset: 0, hour: 8, minute: 30 },
  MOFU: { dayOffset: 2, hour: 11, minute: 45 },
  BOFU: { dayOffset: 4, hour: 9, minute: 15 },
};

export function getOptimalPostingTime(baseDate: Date, pillar: "TOFU" | "MOFU" | "BOFU"): Date {
  if (Number.isNaN(baseDate.getTime())) throw new Error("baseDate invÃ¡lida.");

  // Encontra a segunda-feira da semana da data-base usando o calendÃ¡rio UTC.
  const monday = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate()));
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday + peakSchedule[pillar].dayOffset);

  // 08:30 BRT = 11:30 UTC; 11:45 BRT = 14:45 UTC; 09:15 BRT = 12:15 UTC.
  const { hour, minute } = peakSchedule[pillar];
  monday.setUTCHours(hour + 3, minute, 0, 0);
  return monday;
}
