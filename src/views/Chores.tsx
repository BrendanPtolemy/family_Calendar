import { useState } from 'react';
import type { Chore, ChoreSchedule } from '../../shared/types';
import { del, post, put } from '../api';
import { Avatar, MemberPicker } from '../components/Avatar';
import { ChoreCard, Progress } from '../components/ChoreCard';
import { Modal } from '../components/Modal';
import { useAction, useFamily } from '../family';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function scheduleLabel(s: ChoreSchedule) {
  if (s.type === 'daily') return 'Every day';
  if (s.type === 'once') return `Once on ${s.date}`;
  return s.days.map((d) => DAYS[d]).join(', ');
}

export function ChoresView() {
  const { state, isParent, requireParent, member, balance } = useFamily();
  const act = useAction();
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<Chore | 'new' | null>(null);
  const s = state!;
  const people = s.members.filter((m) => s.todayChores.some((t) => t.memberId === m.id));

  return (
    <div className="view chores">
      <div className="toolbar">
        <h2 className="toolbar-title">Today's chores</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => requireParent(() => setManaging(true))}>🔒 Manage chores</button>
      </div>

      {isParent && s.pendingCompletions.length > 0 && (
        <div className="card approvals">
          <h3>Check these off</h3>
          {s.pendingCompletions.map((c) => {
            const chore = s.chores.find((x) => x.id === c.choreId);
            const m = member(c.memberId);
            return (
              <div key={c.id} className="approval-row">
                {m && <Avatar member={m} size={36} />}
                <span>
                  <strong>{m?.name}</strong> did {chore?.emoji} {chore?.title ?? 'a chore'} <span className="muted">({c.date})</span>
                </span>
                <span className="spacer" />
                <button className="btn" onClick={() => act(() => post(`/completions/${c.id}/reject`), 'Sent back')}>Not yet</button>
                <button className="btn primary" onClick={() => act(() => post(`/completions/${c.id}/approve`), `+${c.stars} ⭐ for ${m?.name}`)}>Approve</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="columns" style={{ '--n': Math.max(1, people.length) } as React.CSSProperties}>
        {people.map((m) => {
          const mine = s.todayChores.filter((t) => t.memberId === m.id);
          const done = mine.filter((t) => t.completion).length;
          return (
            <section key={m.id} className="column big" style={{ '--c': m.color } as React.CSSProperties}>
              <header className="column-head">
                <Avatar member={m} size={56} />
                <div className="column-name">
                  <strong>{m.name}</strong>
                  <span className="muted">{balance(m.id)?.starsAvailable ?? 0} ⭐ to spend</span>
                </div>
                <Progress done={done} total={mine.length} color={m.color} size={62} />
              </header>
              <div className="column-body">
                {mine.map((t) => (
                  <ChoreCard key={t.chore.id} item={t} color={m.color} />
                ))}
              </div>
            </section>
          );
        })}
        {!people.length && <p className="empty">No chores today. Add some with Manage chores.</p>}
      </div>

      {managing && (
        <Modal
          title="Manage chores"
          wide
          onClose={() => setManaging(false)}
          footer={<button className="btn primary" onClick={() => setEditing('new')}>＋ New chore</button>}
        >
          <div className="list">
            {s.chores.map((c) => (
              <button key={c.id} className="list-row" onClick={() => setEditing(c)}>
                <span className="list-emoji">{c.emoji}</span>
                <span className="list-main">
                  <strong>{c.title}</strong>
                  <span className="muted">
                    {scheduleLabel(c.schedule)} · {c.stars}⭐{c.needsApproval ? ' · parent checks' : ''}
                  </span>
                </span>
                <span className="list-avatars">
                  {c.assigneeIds.map((id) => member(id)).map((m) => m && <Avatar key={m.id} member={m} size={30} />)}
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {editing && <ChoreEditor chore={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ChoreEditor({ chore, onClose }: { chore?: Chore; onClose: () => void }) {
  const { state } = useFamily();
  const act = useAction();
  const [title, setTitle] = useState(chore?.title ?? '');
  const [emoji, setEmoji] = useState(chore?.emoji ?? '✅');
  const [stars, setStars] = useState(chore?.stars ?? 1);
  const [assigneeIds, setAssignees] = useState<string[]>(chore?.assigneeIds ?? []);
  const [schedule, setSchedule] = useState<ChoreSchedule>(chore?.schedule ?? { type: 'daily' });
  const [needsApproval, setNeedsApproval] = useState(chore?.needsApproval ?? false);

  const save = async () => {
    const body = { title, emoji, stars, assigneeIds, schedule, needsApproval };
    if (await act(() => (chore ? put(`/chores/${chore.id}`, body) : post('/chores', body)), 'Saved')) onClose();
  };
  const remove = async () => {
    if (chore && confirm(`Remove "${chore.title}"? Stars already earned are kept.`) && (await act(() => del(`/chores/${chore.id}`), 'Removed'))) onClose();
  };
  const days = schedule.type === 'weekly' ? schedule.days : [];

  return (
    <Modal
      title={chore ? 'Edit chore' : 'New chore'}
      onClose={onClose}
      footer={
        <>
          {chore && <button className="btn danger" onClick={remove}>Remove</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!title.trim() || !assigneeIds.length} onClick={save}>Save</button>
        </>
      }
    >
      <div className="row">
        <label className="field narrow">
          <span>Icon</span>
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} className="emoji-input" />
        </label>
        <label className="field">
          <span>Chore</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Feed the cat" />
        </label>
        <label className="field narrow">
          <span>Stars</span>
          <input type="number" min={0} max={100} value={stars} onChange={(e) => setStars(Number(e.target.value))} />
        </label>
      </div>
      <label className="field">
        <span>Who</span>
        <MemberPicker members={state!.members} value={assigneeIds} onChange={setAssignees} />
      </label>
      <label className="field">
        <span>When</span>
        <div className="seg">
          <button type="button" className={schedule.type === 'daily' ? 'on' : ''} onClick={() => setSchedule({ type: 'daily' })}>Every day</button>
          <button type="button" className={schedule.type === 'weekly' ? 'on' : ''} onClick={() => setSchedule({ type: 'weekly', days: days.length ? days : [6] })}>Some days</button>
          <button type="button" className={schedule.type === 'once' ? 'on' : ''} onClick={() => setSchedule({ type: 'once', date: state!.today })}>Once</button>
        </div>
      </label>
      {schedule.type === 'weekly' && (
        <div className="day-picker">
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              className={days.includes(i) ? 'on' : ''}
              onClick={() => setSchedule({ type: 'weekly', days: days.includes(i) ? days.filter((x) => x !== i) : [...days, i] })}
            >
              {d}
            </button>
          ))}
        </div>
      )}
      {schedule.type === 'once' && (
        <label className="field">
          <span>Date</span>
          <input type="date" value={schedule.date} onChange={(e) => setSchedule({ type: 'once', date: e.target.value })} />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={needsApproval} onChange={(e) => setNeedsApproval(e.target.checked)} /> A parent checks it before stars count
      </label>
    </Modal>
  );
}
