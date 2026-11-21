import type { EditorialPillar } from "@prisma/client";
import { prisma } from "./prisma.ts";
import { DEFAULT_WEEKLY_SCHEDULE, normalizeWeeklySchedule, scheduledDateForEditorialSlot, type EditorialScheduleSlot } from "./editorial-calendar.ts";
import { getPipelineBaseDate, pillarOrder } from "./scheduling.ts";

const reschedulableStatuses = ["APPROVED", "SCHEDULED"] as const;

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

export function nextValidPostingWindow(after: Date, _pillar: EditorialPillar, scheduleInput: unknown = DEFAULT_WEEKLY_SCHEDULE): Date {
  let monday = getPipelineBaseDate(after);
  const schedule = normalizeWeeklySchedule(scheduleInput);
  for (let week = 0; week < 3; week += 1) {
    const candidates = schedule.map((slot: EditorialScheduleSlot) => scheduledDateForEditorialSlot(monday, slot)).sort((a, b) => a.getTime() - b.getTime());
    const next = candidates.find((candidate) => candidate > after);
    if (next) return next;
    monday = new Date(monday.getTime() + 7 * 86400000);
  }
  throw new Error("Nenhum slot editorial futuro encontrado para reagendamento.");
}

export interface ReconciliationResult {
  inspected: number;
  rescheduled: number;
  posts: Array<{ id: string; from: Date; to: Date; pillar: EditorialPillar }>;
}

/**
 * Move approved/scheduled posts out of the past while preserving their
 * chronological order and the TOFU -> MOFU -> BOFU cadence.
 */
export async function reconcileOverduePosts(now = new Date()): Promise<ReconciliationResult> {
  if (Number.isNaN(now.getTime())) throw new Error("Data de reconciliação inválida.");

  const overdue = await prisma.post.findMany({
    where: {
      status: { in: [...reschedulableStatuses] },
      scheduledDate: { lt: now },
    },
    select: {
      id: true,
      editorialPillar: true,
      scheduledDate: true,
      scheduledFor: true,
      createdAt: true,
    },
    orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }],
  });

  if (overdue.length === 0) return { inspected: 0, rescheduled: 0, posts: [] };

  const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" }, select: { weeklySchedule: true } });
  const schedule = normalizeWeeklySchedule(editorialLine?.weeklySchedule);

  const futurePosts = await prisma.post.findMany({
    where: {
      status: { in: [...reschedulableStatuses] },
      scheduledDate: { gte: now },
    },
    select: { scheduledDate: true },
  });
  const occupied = new Set(
    futurePosts.flatMap((post) => post.scheduledDate ? [post.scheduledDate.toISOString()] : []),
  );

  const ordered = [...overdue].sort((left, right) => {
    const dateDifference = (left.scheduledDate?.getTime() ?? left.scheduledFor.getTime())
      - (right.scheduledDate?.getTime() ?? right.scheduledFor.getTime());
    return dateDifference || pillarOrder(left.editorialPillar) - pillarOrder(right.editorialPillar);
  });

  const changes: ReconciliationResult["posts"] = [];
  let cursor = now;
  for (const post of ordered) {
    let nextDate = nextValidPostingWindow(cursor, post.editorialPillar, schedule);
    while (occupied.has(nextDate.toISOString())) {
      nextDate = nextValidPostingWindow(addMilliseconds(nextDate, 1), post.editorialPillar, schedule);
    }

    const updated = await prisma.post.updateMany({
      where: {
        id: post.id,
        status: { in: [...reschedulableStatuses] },
        scheduledDate: post.scheduledDate,
      },
      data: { scheduledDate: nextDate, scheduledFor: nextDate },
    });
    if (updated.count === 0) continue;

    occupied.add(nextDate.toISOString());
    cursor = nextDate;
    changes.push({
      id: post.id,
      from: post.scheduledDate ?? post.scheduledFor,
      to: nextDate,
      pillar: post.editorialPillar,
    });
  }

  return { inspected: overdue.length, rescheduled: changes.length, posts: changes };
}
