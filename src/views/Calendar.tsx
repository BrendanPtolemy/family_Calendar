import { useEffect, useMemo, useState } from 'react';
import type { EventOccurrence, Member } from '../../shared/types';
import { get } from '../api';
import { EventEditor } from '../components/EventEditor';
import { addDays, addMonths, fmt, fromKey, occursOn, startOfMonth, startOfWeek, toKey } from '../dates';
import { useFamily } from '../family';

export function useEvents(from: string, to: string) {
  const { version } = useFamily();
  const [events, setEvents] = useState<EventOccurrence[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    get<EventOccurrence[]>(`/events?from=${from}&to=${to}`)
      .then((e) => live && setEvents(e))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [from, to, version, tick]);
  return { events, reload: () => setTick((t) => t + 1) };
}

export function EventChip({ ev, members, onClick, compact, color: forced }: { ev: EventOccurrence; members: Member[]; onClick: () => void; compact?: boolean; color?: string }) {
  const who = ev.memberIds.map((id) => members.find((m) => m.id === id)).filter((m): m is Member => !!m);
  const color = forced ?? (who.length === 1 ? who[0].color : who.length ? '#6c757d' : '#adb5bd');
  return (
    <button className={`event ${ev.allDay ? 'allday' : ''} ${compact ? 'compact' : ''}`} style={{ '--c': color } as React.CSSProperties} onClick={onClick}>
      {!ev.allDay && <span className="event-time">{fmt.time(ev.start)}</span>}
      <span className="event-title">{ev.title}</span>
      {!compact && who.length > 0 && <span className="event-who">{who.map((m) => m.emoji).join('')}</span>}
    </button>
  );
}

export function CalendarView() {
  const { state } = useFamily();
  const today = state?.today ?? toKey(new Date());
  const weekStartsOn = state?.settings.weekStartsOn ?? 0;
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(today);
  const [filter, setFilter] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ event?: EventOccurrence; date?: string } | null>(null);

  const { from, to, days } = useMemo(() => {
    if (mode === 'week') {
      const s = startOfWeek(anchor, weekStartsOn);
      return { from: s, to: addDays(s, 7), days: Array.from({ length: 7 }, (_, i) => addDays(s, i)) };
    }
    const first = startOfMonth(anchor);
    const s = startOfWeek(first, weekStartsOn);
    const end = addMonths(first, 1);
    const n = Math.ceil((fromKey(end).getTime() - fromKey(s).getTime()) / 86_400_000 / 7) * 7;
    return { from: s, to: addDays(s, n), days: Array.from({ length: n }, (_, i) => addDays(s, i)) };
  }, [mode, anchor, weekStartsOn]);

  const { events } = useEvents(from, to);
  const members = state?.members ?? [];
  const shown = filter.length ? events.filter((e) => e.memberIds.some((id) => filter.includes(id))) : events;
  const step = (n: number) => setAnchor(mode === 'week' ? addDays(anchor, 7 * n) : addMonths(anchor, n));
  const title = mode === 'week' ? `${fmt.dayMonth(days[0])} – ${fmt.dayMonth(days[6])}` : fmt.month(anchor);

  return (
    <div className="view calendar">
      <div className="toolbar">
        <div className="seg">
          <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>Week</button>
          <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Month</button>
        </div>
        <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous">‹</button>
        <button className="btn" onClick={() => setAnchor(today)}>Today</button>
        <button className="icon-btn" onClick={() => step(1)} aria-label="Next">›</button>
        <h2 className="toolbar-title">{title}</h2>
        <span className="spacer" />
        <div className="filters">
          {members.map((m) => (
            <button
              key={m.id}
              className={`filter ${filter.includes(m.id) ? 'on' : ''}`}
              style={{ '--c': m.color } as React.CSSProperties}
              onClick={() => setFilter(filter.includes(m.id) ? filter.filter((x) => x !== m.id) : [...filter, m.id])}
              title={`Only ${m.name}`}
            >
              {m.emoji}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => setEditing({ date: anchor })}>＋ Event</button>
      </div>

      {mode === 'week' ? (
        <div className="week">
          {days.map((d) => {
            const list = shown.filter((e) => occursOn(e, d));
            return (
              <div key={d} className={`week-day ${d === today ? 'today' : ''}`} onDoubleClick={() => setEditing({ date: d })}>
                <button className="day-head" onClick={() => setEditing({ date: d })} title="Add event">
                  <span className="dow">{fmt.weekday(d)}</span>
                  <span className="dnum">{fromKey(d).getDate()}</span>
                </button>
                <div className="day-events">
                  {list.map((e) => (
                    <EventChip key={e.occurrenceId} ev={e} members={members} onClick={() => setEditing({ event: e })} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="month">
          {days.slice(0, 7).map((d) => (
            <div key={d} className="month-dow">{fmt.weekday(d)}</div>
          ))}
          {days.map((d) => {
            const list = shown.filter((e) => occursOn(e, d));
            const out = d.slice(0, 7) !== anchor.slice(0, 7);
            return (
              <div key={d} className={`month-cell ${d === today ? 'today' : ''} ${out ? 'out' : ''}`} onClick={(ev) => ev.target === ev.currentTarget && setEditing({ date: d })}>
                <span className="dnum">{fromKey(d).getDate()}</span>
                {list.slice(0, 3).map((e) => (
                  <EventChip key={e.occurrenceId} ev={e} members={members} compact onClick={() => setEditing({ event: e })} />
                ))}
                {list.length > 3 && (
                  <button className="more" onClick={() => { setAnchor(d); setMode('week'); }}>+{list.length - 3} more</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && <EventEditor event={editing.event} date={editing.date} onClose={() => setEditing(null)} />}
    </div>
  );
}
