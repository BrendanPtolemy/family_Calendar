// Starter household so the display looks alive on first run.
// Everything here is editable from the Settings screen.

import { randomUUID, createHash, randomBytes } from 'node:crypto';
import type { Data } from './store.js';
import type { CalendarEvent, Chore, Meal, Reward } from '../shared/types.js';

const id = () => randomUUID();

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function at(base: Date, dayOffset: number, hh: number, mm = 0): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

export function buildSeed(now: Date): Data {
  const salt = randomBytes(16).toString('hex');
  const parent1 = { id: id(), name: 'Mom', color: '#e76f51', emoji: '🌻', role: 'parent' as const, calendarFeeds: [] };
  const parent2 = { id: id(), name: 'Dad', color: '#2a9d8f', emoji: '🌲', role: 'parent' as const, calendarFeeds: [] };
  const kid1 = { id: id(), name: 'Ava', color: '#9b5de5', emoji: '🦄', role: 'kid' as const, calendarFeeds: [] };
  const kid2 = { id: id(), name: 'Leo', color: '#f4a261', emoji: '🦖', role: 'kid' as const, calendarFeeds: [] };
  const kids = [kid1.id, kid2.id];

  // Seed around the current Sunday-start week (the default display setting).
  const sunday = new Date(now);
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  const dow = now.getDay();
  const day = (n: number) => {
    const d = new Date(sunday);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  };

  const ev = (e: Omit<CalendarEvent, 'id' | 'recurrence'> & Partial<Pick<CalendarEvent, 'recurrence'>>): CalendarEvent => ({
    id: id(),
    recurrence: 'none',
    ...e,
  });

  const events: CalendarEvent[] = [
    ev({ title: 'Soccer practice', start: at(sunday, 1, 17, 30), end: at(sunday, 1, 18, 30), allDay: false, memberIds: [kid2.id], location: 'Riverside Park', recurrence: 'weekly' }),
    ev({ title: 'Piano lesson', start: at(sunday, 2, 16), end: at(sunday, 2, 16, 45), allDay: false, memberIds: [kid1.id], recurrence: 'weekly' }),
    ev({ title: 'Family movie night', start: at(sunday, 5, 19), end: at(sunday, 5, 21), allDay: false, memberIds: [parent1.id, parent2.id, kid1.id, kid2.id], recurrence: 'weekly' }),
    ev({ title: 'Dentist', start: at(now, 0, 15, 30), end: at(now, 0, 16, 15), allDay: false, memberIds: [kid1.id, parent1.id] }),
    ev({ title: 'Book club', start: at(sunday, 4, 19), end: at(sunday, 4, 21), allDay: false, memberIds: [parent1.id], recurrence: 'weekly' }),
    ev({ title: 'Early meeting', start: at(sunday, 2, 7, 30), end: at(sunday, 2, 8, 30), allDay: false, memberIds: [parent2.id] }),
    ev({ title: 'Grandma visiting', start: day(6), end: day(9), allDay: true, memberIds: [parent1.id, parent2.id, kid1.id, kid2.id] }),
    ev({ title: 'Book fair', start: day(3), end: day(4), allDay: true, memberIds: kids }),
  ];

  const chore = (c: Omit<Chore, 'id' | 'archived' | 'needsApproval'> & { needsApproval?: boolean }): Chore => ({
    id: id(),
    archived: false,
    needsApproval: false,
    ...c,
  });

  const chores: Chore[] = [
    chore({ title: 'Make bed', emoji: '🛏️', assigneeIds: kids, stars: 1, schedule: { type: 'daily' } }),
    chore({ title: 'Brush teeth (AM + PM)', emoji: '🪥', assigneeIds: kids, stars: 1, schedule: { type: 'daily' } }),
    chore({ title: 'Feed the dog', emoji: '🐶', assigneeIds: [kid1.id], stars: 2, schedule: { type: 'daily' } }),
    chore({ title: 'Set the table', emoji: '🍽️', assigneeIds: [kid2.id], stars: 2, schedule: { type: 'daily' } }),
    chore({ title: 'Homework done', emoji: '📚', assigneeIds: kids, stars: 3, schedule: { type: 'weekly', days: [1, 2, 3, 4] }, needsApproval: true }),
    chore({ title: 'Tidy bedroom', emoji: '🧸', assigneeIds: kids, stars: 3, schedule: { type: 'weekly', days: [6] }, needsApproval: true }),
    chore({ title: 'Take out recycling', emoji: '♻️', assigneeIds: [kid1.id], stars: 2, schedule: { type: 'weekly', days: [3] } }),
    chore({ title: 'Unload dishwasher', emoji: '🧼', assigneeIds: [parent2.id], stars: 0, schedule: { type: 'daily' } }),
  ];

  const reward = (r: Omit<Reward, 'id' | 'archived'>): Reward => ({ id: id(), archived: false, ...r });
  const rewards: Reward[] = [
    reward({ title: '30 min screen time', emoji: '📱', cost: 5, kind: 'screen_time', screenMinutes: 30 }),
    reward({ title: '1 hour screen time', emoji: '🎮', cost: 9, kind: 'screen_time', screenMinutes: 60 }),
    reward({ title: 'Pick dinner', emoji: '🍕', cost: 8, kind: 'privilege' }),
    reward({ title: 'Stay up 30 min late', emoji: '🌙', cost: 10, kind: 'privilege' }),
    reward({ title: 'Choose movie night film', emoji: '🎬', cost: 6, kind: 'privilege' }),
    reward({ title: 'Skip one chore', emoji: '🎟️', cost: 7, kind: 'privilege' }),
    reward({ title: 'One-on-one date with a parent', emoji: '💛', cost: 20, kind: 'activity' }),
    reward({ title: 'Friend sleepover', emoji: '🏕️', cost: 30, kind: 'activity' }),
    reward({ title: 'Baking day', emoji: '🧁', cost: 12, kind: 'activity' }),
  ];

  const mealIdeas: [string, string[]][] = [
    ['Slow-cooker chili', ['ground beef', 'kidney beans', 'diced tomatoes', 'onion']],
    ['Tacos', ['tortillas', 'ground beef', 'cheddar', 'lettuce', 'salsa']],
    ['Spaghetti & meatballs', ['spaghetti', 'meatballs', 'marinara', 'parmesan']],
    ['Sheet-pan chicken & veggies', ['chicken thighs', 'broccoli', 'potatoes', 'lemons']],
    ['Breakfast for dinner', ['eggs', 'pancake mix', 'bacon', 'berries']],
    ['Homemade pizza', ['pizza dough', 'mozzarella', 'pepperoni', 'marinara']],
    ['Burgers on the grill', ['burger buns', 'ground beef', 'cheddar', 'tomatoes']],
  ];
  const meals: Meal[] = mealIdeas.map(([title, ingredients], i) => ({
    id: id(),
    date: day(i),
    slot: 'dinner',
    title,
    ingredients,
  }));
  meals.push({ id: id(), date: day(6), slot: 'breakfast', title: 'Waffles with Grandma', ingredients: ['waffle mix', 'syrup'] });

  const groceries = [
    ['Milk', '1 gal', 'Dairy'],
    ['Bananas', '1 bunch', 'Produce'],
    ['Bread', '', 'Bakery'],
    ['Apples', '6', 'Produce'],
    ['Dog food', '1 bag', 'Pets'],
    ['Paper towels', '', 'Household'],
  ].map(([name, quantity, category]) => ({ id: id(), name, quantity: quantity || undefined, category, checked: false }));

  // A little history so stars and streaks aren't all zero.
  const completions = [] as Data['completions'];
  for (let back = 1; back <= Math.max(3, dow); back++) {
    const d = new Date(now);
    d.setDate(d.getDate() - back);
    const key = dateKey(d);
    for (const c of chores.filter((c) => c.schedule.type === 'daily')) {
      for (const m of c.assigneeIds) {
        completions.push({ id: id(), choreId: c.id, memberId: m, date: key, status: 'approved', stars: c.stars, at: d.toISOString() });
      }
    }
  }

  return {
    version: 1,
    settings: {
      familyName: 'Our Family',
      pinSalt: salt,
      pinHash: createHash('sha256').update(`${salt}:1234`).digest('hex'),
      pinIsDefault: true,
      weekStartsOn: 0,
    },
    members: [parent1, parent2, kid1, kid2],
    events,
    chores,
    completions,
    rewards,
    redemptions: [],
    screenUses: [],
    devices: [],
    sample: { meals, groceries },
  };
}
