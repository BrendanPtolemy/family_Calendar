import { useEffect, useState } from 'react';
import type { EventOccurrence, GroceryItem, Meal } from '../../shared/types';
import { get } from '../api';
import { Avatar } from '../components/Avatar';
import { ChoreCard, Progress } from '../components/ChoreCard';
import { EventEditor } from '../components/EventEditor';
import { addDays, occursOn } from '../dates';
import { useFamily } from '../family';
import { EventChip, useEvents } from './Calendar';

export function TodayView({ go }: { go: (tab: string) => void }) {
  const { state, balance, version } = useFamily();
  const [editing, setEditing] = useState<{ event?: EventOccurrence; date?: string } | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [groceries, setGroceries] = useState<GroceryItem[]>([]);
  const today = state!.today;
  const { events } = useEvents(today, addDays(today, 2));

  useEffect(() => {
    get<Meal[]>(`/meals?from=${today}&to=${addDays(today, 2)}`).then(setMeals).catch(() => {});
    get<GroceryItem[]>('/groceries').then(setGroceries).catch(() => {});
  }, [today, version]);

  const members = state!.members;
  const todays = events.filter((e) => occursOn(e, today));
  const tomorrow = events.filter((e) => occursOn(e, addDays(today, 1)));
  const shared = todays.filter((e) => e.memberIds.length === 0 || e.memberIds.length === members.length);
  const dinner = meals.find((m) => m.date === today && m.slot === 'dinner');
  const pending = state!.pendingCompletions.length + state!.pendingRedemptions.length;

  return (
    <div className="view today">
      <div className="today-strip">
        <button className="card strip-card" onClick={() => go('meals')}>
          <span className="strip-label">Tonight's dinner</span>
          <span className="strip-value">{dinner ? dinner.title : 'Not planned yet'}</span>
        </button>
        <button className="card strip-card" onClick={() => go('groceries')}>
          <span className="strip-label">Grocery list</span>
          <span className="strip-value">{groceries.filter((g) => !g.checked).length} items</span>
        </button>
        <button className="card strip-card" onClick={() => setEditing({ date: today })}>
          <span className="strip-label">Tomorrow</span>
          <span className="strip-value small">{tomorrow.length ? tomorrow.slice(0, 2).map((e) => e.title).join(', ') + (tomorrow.length > 2 ? ` +${tomorrow.length - 2}` : '') : 'Nothing yet'}</span>
        </button>
        {pending > 0 && (
          <button className="card strip-card attention" onClick={() => go('rewards')}>
            <span className="strip-label">Waiting on a parent</span>
            <span className="strip-value">{pending} to check</span>
          </button>
        )}
      </div>

      {shared.length > 0 && (
        <div className="shared-events">
          <span className="muted">Everyone</span>
          {shared.map((e) => (
            <EventChip key={e.occurrenceId} ev={e} members={members} onClick={() => setEditing({ event: e })} />
          ))}
        </div>
      )}

      <div className="columns" style={{ '--n': members.length } as React.CSSProperties}>
        {members.map((m) => {
          const mine = state!.todayChores.filter((t) => t.memberId === m.id);
          const done = mine.filter((t) => t.completion).length;
          const evs = todays.filter((e) => e.memberIds.includes(m.id) && !shared.includes(e));
          const bal = balance(m.id);
          const streak = state!.streaks[m.id] ?? 0;
          return (
            <section key={m.id} className="column" style={{ '--c': m.color } as React.CSSProperties}>
              <header className="column-head">
                <Avatar member={m} size={48} />
                <div className="column-name">
                  <strong>{m.name}</strong>
                  <span className="muted">
                    {bal && (m.role === 'kid' || bal.starsEarned > 0) ? `${bal.starsAvailable} ⭐` : ''}
                    {streak >= 2 ? `  🔥 ${streak}` : ''}
                  </span>
                </div>
                {mine.length > 0 && <Progress done={done} total={mine.length} color={m.color} />}
              </header>
              <div className="column-body">
                {evs.map((e) => (
                  <EventChip key={e.occurrenceId} ev={e} members={members} color={m.color} onClick={() => setEditing({ event: e })} />
                ))}
                {mine.map((t) => (
                  <ChoreCard key={t.chore.id} item={t} color={m.color} />
                ))}
                {!evs.length && !mine.length && <p className="empty">Free day ☀️</p>}
              </div>
            </section>
          );
        })}
      </div>
      {editing && <EventEditor event={editing.event} date={editing.date} onClose={() => setEditing(null)} />}
    </div>
  );
}
