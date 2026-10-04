import { useState } from 'react';
import type { CalendarEvent, EventOccurrence, Recurrence } from '../../shared/types';
import { del, post, put } from '../api';
import { addDays, toKey, toLocalInput } from '../dates';
import { useAction, useFamily } from '../family';
import { MemberPicker } from './Avatar';
import { Modal } from './Modal';

/** Edit a family event, or create one on `date`. Feed events open read-only. */
export function EventEditor({ event, date, onClose }: { event?: EventOccurrence; date?: string; onClose: () => void }) {
  const { state } = useFamily();
  const act = useAction();
  const base: CalendarEvent | undefined = event && !event.readOnly ? event : undefined;
  const day = date ?? toKey(new Date());
  const s0 = event?.seriesStart ?? event?.start;
  const e0 = event?.seriesEnd ?? event?.end;
  const [title, setTitle] = useState(event?.title ?? '');
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [start, setStart] = useState(event && s0 ? (event.allDay ? s0 : toLocalInput(s0)) : `${day}T16:00`);
  const [end, setEnd] = useState(event && e0 ? (event.allDay ? addDays(e0, -1) : toLocalInput(e0)) : `${day}T17:00`);
  const [memberIds, setMemberIds] = useState<string[]>(event?.memberIds ?? []);
  const [location, setLocation] = useState(event?.location ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence>(event?.recurrence ?? 'none');

  if (event?.readOnly) {
    const who = event.memberIds.map((id) => state?.members.find((m) => m.id === id)?.name).filter(Boolean).join(', ');
    return (
      <Modal title={event.title} onClose={onClose}>
        <p>{event.allDay ? 'All day' : `${new Date(event.start).toLocaleString()} – ${new Date(event.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</p>
        {event.location && <p>📍 {event.location}</p>}
        <p className="muted">From {who}'s linked calendar. Edit it there.</p>
      </Modal>
    );
  }

  const toggleAllDay = (v: boolean) => {
    setAllDay(v);
    if (v) {
      setStart(start.slice(0, 10));
      setEnd(end.slice(0, 10));
    } else {
      setStart(`${start.slice(0, 10)}T16:00`);
      setEnd(`${end.slice(0, 10)}T17:00`);
    }
  };

  const save = async () => {
    const body = {
      title,
      allDay,
      start: allDay ? start : new Date(start).toISOString(),
      end: allDay ? addDays(end, 1) : new Date(end).toISOString(),
      memberIds,
      location,
      notes,
      recurrence,
    };
    const ok = await act(() => (base ? put(`/events/${base.id}`, body) : post('/events', body)), base ? 'Event updated' : 'Event added');
    if (ok) onClose();
  };

  const remove = async () => {
    if (!base) return;
    const msg = base.recurrence !== 'none' ? 'Delete every repeat of this event?' : 'Delete this event?';
    if (!confirm(msg)) return;
    if (await act(() => del(`/events/${base.id}`), 'Event deleted')) onClose();
  };

  return (
    <Modal
      title={base ? 'Edit event' : 'New event'}
      onClose={onClose}
      footer={
        <>
          {base && <button className="btn danger" onClick={remove}>Delete</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!title.trim()} onClick={save}>Save</button>
        </>
      }
    >
      <label className="field">
        <span>What</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Soccer practice" />
      </label>
      <label className="field">
        <span>Who</span>
        <MemberPicker members={state?.members ?? []} value={memberIds} onChange={setMemberIds} />
      </label>
      <label className="check">
        <input type="checkbox" checked={allDay} onChange={(e) => toggleAllDay(e.target.checked)} /> All day
      </label>
      <div className="row">
        <label className="field">
          <span>Starts</span>
          <input type={allDay ? 'date' : 'datetime-local'} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>Ends</span>
          <input type={allDay ? 'date' : 'datetime-local'} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <label className="field">
          <span>Repeats</span>
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            <option value="none">Never</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
          </select>
        </label>
        <label className="field">
          <span>Where</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </Modal>
  );
}
