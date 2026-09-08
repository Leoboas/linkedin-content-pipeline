import type { EditorialPillar } from "@prisma/client";

export const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

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

/** Converts an HTML datetime-local value as BRT (UTC-3), independently of the host timezone. */
export function parseDateTimeLocalInBrazil(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("Data e hora devem estar no formato YYYY-MM-DDTHH:mm.");
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) + 3, Number(minute)));
  if (Number.isNaN(date.getTime())) throw new Error("Data e hora inválidas.");
  return date;
}

export function formatDateTimeLocalInBrazil(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error("Data inválida.");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatDateInBrazil(date: Date): string {
  return date.toLocaleString("pt-BR", { timeZone: BRAZIL_TIME_ZONE, dateStyle: "short", timeStyle: "short" });
}

export function dateKeyInBrazil(date: Date): string {
  return formatDateTimeLocalInBrazil(date).slice(0, 10);
}
