// Pure family logic: chore schedules, star balances and event recurrence.
// Kept free of I/O so it is easy to test.

import type {
  CalendarEvent,
  Chore,
  ChoreCompletion,
  EventOccurrence,
  MemberBalance,
  Redemption,
  ScreenTimeUse,
} from '../shared/types.js';

/** YYYY-MM-DD for a Date in local time. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as local midnight. */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

export function isChoreDue(chore: Chore, dateKey: string): boolean {
  if (chore.archived) return false;
  const s = chore.schedule;
  switch (s.type) {
    case 'daily':
      return true;
    case 'weekly':
      return s.days.includes(fromDateKey(dateKey).getDay());
    case 'once':
      return s.date === dateKey;
  }
}

export function computeBalance(
  memberId: string,
  completions: ChoreCompletion[],
  redemptions: Redemption[],
  screenUses: ScreenTimeUse[],
): MemberBalance {
  let earned = 0;
  let pending = 0;
  for (const c of completions) {
    if (c.memberId !== memberId) continue;
    if (c.status === 'approved') earned += c.stars;
    else pending += c.stars;
  }
  let spent = 0;
  let banked = 0;
  for (const r of redemptions) {
    if (r.memberId !== memberId || r.status === 'denied') continue;
    // Requested redemptions hold their stars so they can't be double-spent.
    spent += r.cost;
    if (r.status === 'approved') banked += r.screenMinutes;
  }
  for (const u of screenUses) {
    if (u.memberId === memberId) banked -= u.minutes;
  }
  return {
    memberId,
    starsEarned: earned,
    starsPending: pending,
    starsSpent: spent,
    starsAvailable: earned - spent,
    screenMinutesBanked: Math.max(0, banked),
  };
}

/** Consecutive days (ending today, or yesterday if today isn't finished) with every due chore done. */
export function computeStreak(
  memberId: string,
  chores: Chore[],
  completions: ChoreCompletion[],
  todayKey: string,
  maxDays = 365,
): number {
  const done = new Set(
    completions.filter((c) => c.memberId === memberId).map((c) => `${c.choreId}|${c.date}`),
  );
  const mine = chores.filter((c) => c.assigneeIds.includes(memberId));
  const dayComplete = (key: string) => {
    const due = mine.filter((c) => isChoreDue(c, key));
    return due.length > 0 && due.every((c) => done.has(`${c.id}|${key}`));
  };
  let streak = 0;
  let key = todayKey;
  if (!dayComplete(key)) key = addDays(key, -1);
  for (let i = 0; i < maxDays; i++) {
    const due = mine.some((c) => isChoreDue(c, key));
    if (!due) {
      key = addDays(key, -1);
      continue; // days with nothing due don't break a streak
    }
    if (!dayComplete(key)) break;
    streak++;
    key = addDays(key, -1);
  }
  return streak;
}

function shift(iso: string, allDay: boolean, recurrence: CalendarEvent['recurrence'], n: number): string {
  const d = allDay ? fromDateKey(iso) : new Date(iso);
  if (recurrence === 'daily') d.setDate(d.getDate() + n);
  else if (recurrence === 'weekly') d.setDate(d.getDate() + 7 * n);
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + n);
  return allDay ? toDateKey(d) : d.toISOString();
}

function startMs(iso: string, allDay: boolean): number {
  return (allDay ? fromDateKey(iso) : new Date(iso)).getTime();
}

/** Expand family events into concrete occurrences overlapping [from, to). */
export function expandEvents(events: CalendarEvent[], from: Date, to: Date): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  const fromMs = from.getTime();
  const toMs = to.getTime();
  for (const ev of events) {
    const untilMs = ev.recurrenceUntil ? fromDateKey(ev.recurrenceUntil).getTime() + 86_400_000 : Infinity;
    for (let n = 0; n < 2000; n++) {
      if (ev.recurrence === 'none' && n > 0) break;
      const start = n === 0 ? ev.start : shift(ev.start, ev.allDay, ev.recurrence, n);
      const end = n === 0 ? ev.end : shift(ev.end, ev.allDay, ev.recurrence, n);
      const s = startMs(start, ev.allDay);
      const e = startMs(end, ev.allDay);
      if (s >= toMs || s >= untilMs) break;
      if (e > fromMs || (e === s && s >= fromMs)) {
        out.push({ ...ev, start, end, seriesStart: ev.start, seriesEnd: ev.end, occurrenceId: `${ev.id}:${n}`, source: 'family', readOnly: false });
      }
    }
  }
  return out;
}

export function sortOccurrences(list: EventOccurrence[]): EventOccurrence[] {
  return list.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return startMs(a.start, a.allDay) - startMs(b.start, b.allDay);
  });
}
