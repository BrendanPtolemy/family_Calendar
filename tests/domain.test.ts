import { describe, expect, it } from 'vitest';
import { computeBalance, computeStreak, expandEvents, fromDateKey, isChoreDue } from '../server/domain.js';
import type { CalendarEvent, Chore, ChoreCompletion } from '../shared/types.js';

const chore = (over: Partial<Chore> = {}): Chore => ({
  id: 'c1', title: 'Make bed', emoji: '🛏️', assigneeIds: ['kid'], stars: 2,
  schedule: { type: 'daily' }, needsApproval: false, archived: false, ...over,
});
const done = (date: string, over: Partial<ChoreCompletion> = {}): ChoreCompletion => ({
  id: `x-${date}`, choreId: 'c1', memberId: 'kid', date, status: 'approved', stars: 2, at: '', ...over,
});

describe('chore schedules', () => {
  it('handles daily, weekly and one-off chores', () => {
    expect(isChoreDue(chore(), '2026-10-05')).toBe(true);
    const weekly = chore({ schedule: { type: 'weekly', days: [1, 3] } }); // Mon, Wed
    expect(isChoreDue(weekly, '2026-10-05')).toBe(true); // Monday
    expect(isChoreDue(weekly, '2026-10-06')).toBe(false);
    expect(isChoreDue(chore({ schedule: { type: 'once', date: '2026-10-06' } }), '2026-10-06')).toBe(true);
    expect(isChoreDue(chore({ archived: true }), '2026-10-05')).toBe(false);
  });
});

describe('star balance', () => {
  it('counts approved stars, holds requested rewards and banks screen time', () => {
    const b = computeBalance(
      'kid',
      [done('2026-10-01'), done('2026-10-02'), done('2026-10-03', { status: 'pending' })],
      [
        { id: 'r1', rewardId: 'tv', memberId: 'kid', cost: 1, screenMinutes: 30, status: 'approved', at: '' },
        { id: 'r2', rewardId: 'x', memberId: 'kid', cost: 1, screenMinutes: 0, status: 'requested', at: '' },
        { id: 'r3', rewardId: 'x', memberId: 'kid', cost: 5, screenMinutes: 0, status: 'denied', at: '' },
      ],
      [{ id: 'u', memberId: 'kid', minutes: 10, at: '' }],
    );
    expect(b).toMatchObject({ starsEarned: 4, starsPending: 2, starsSpent: 2, starsAvailable: 2, screenMinutesBanked: 20 });
  });
});

describe('streaks', () => {
  it('counts consecutive complete days and tolerates an unfinished today', () => {
    const cs = [done('2026-10-01'), done('2026-10-02'), done('2026-10-03')];
    expect(computeStreak('kid', [chore()], cs, '2026-10-04')).toBe(3);
    expect(computeStreak('kid', [chore()], [...cs, done('2026-10-04')], '2026-10-04')).toBe(4);
    expect(computeStreak('kid', [chore()], [done('2026-10-01'), done('2026-10-03')], '2026-10-04')).toBe(1);
  });
  it('skips days with nothing due', () => {
    const weekly = chore({ schedule: { type: 'weekly', days: [1] } }); // Mondays
    expect(computeStreak('kid', [weekly], [done('2026-09-28'), done('2026-10-05')], '2026-10-07')).toBe(2);
  });
});

describe('event recurrence', () => {
  const base: CalendarEvent = {
    id: 'e', title: 'Soccer', start: new Date(2026, 9, 6, 17, 30).toISOString(), end: new Date(2026, 9, 6, 18, 30).toISOString(),
    allDay: false, memberIds: [], recurrence: 'weekly',
  };
  it('expands weekly events within the window', () => {
    const occ = expandEvents([base], fromDateKey('2026-10-01'), fromDateKey('2026-11-01'));
    expect(occ.map((o) => new Date(o.start).getDate())).toEqual([6, 13, 20, 27]);
  });
  it('respects repeat-until and multi-day all-day events', () => {
    const until = expandEvents([{ ...base, recurrenceUntil: '2026-10-13' }], fromDateKey('2026-10-01'), fromDateKey('2026-11-01'));
    expect(until).toHaveLength(2);
    const trip: CalendarEvent = { ...base, allDay: true, start: '2026-10-09', end: '2026-10-12', recurrence: 'none' };
    expect(expandEvents([trip], fromDateKey('2026-10-10'), fromDateKey('2026-10-11'))).toHaveLength(1);
    expect(expandEvents([trip], fromDateKey('2026-10-12'), fromDateKey('2026-10-13'))).toHaveLength(0);
  });
});
