export function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fromKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(k: string, n: number): string {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
}
export function startOfWeek(k: string, weekStartsOn: 0 | 1): string {
  const d = fromKey(k);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(k, -diff);
}
export function startOfMonth(k: string): string {
  return k.slice(0, 8) + '01';
}
export function addMonths(k: string, n: number): string {
  const d = fromKey(startOfMonth(k));
  d.setMonth(d.getMonth() + n);
  return toKey(d);
}
export const fmt = {
  time: (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  weekday: (k: string) => fromKey(k).toLocaleDateString([], { weekday: 'short' }),
  weekdayLong: (k: string) => fromKey(k).toLocaleDateString([], { weekday: 'long' }),
  dayMonth: (k: string) => fromKey(k).toLocaleDateString([], { month: 'short', day: 'numeric' }),
  long: (k: string) => fromKey(k).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
  month: (k: string) => fromKey(k).toLocaleDateString([], { month: 'long', year: 'numeric' }),
};

/** Local datetime-input value ("2026-10-04T15:30") from ISO. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${toKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Does an occurrence touch the given day? */
export function occursOn(ev: { start: string; end: string; allDay: boolean }, k: string): boolean {
  if (ev.allDay) return ev.start <= k && k < ev.end;
  const dayStart = fromKey(k).getTime();
  const dayEnd = fromKey(addDays(k, 1)).getTime();
  const s = new Date(ev.start).getTime();
  const e = new Date(ev.end).getTime();
  return s < dayEnd && (e > dayStart || (e === s && s >= dayStart));
}
