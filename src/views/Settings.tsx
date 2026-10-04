import { useEffect, useState } from 'react';
import type { DeviceInfo, Member } from '../../shared/types';
import { del, get, post, put } from '../api';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { useAction, useFamily } from '../family';

interface FeedStatus {
  url: string;
  memberId: string;
  ok: boolean;
  fetchedAt?: string;
  error?: string;
}

const COLORS = ['#e76f51', '#2a9d8f', '#9b5de5', '#f4a261', '#3a86ff', '#ef476f', '#06d6a0', '#8d6e63'];

export function SettingsView() {
  const { state, isParent, requireParent, lock } = useFamily();
  const act = useAction();
  const [familyName, setFamilyName] = useState(state!.settings.familyName);
  const [weekStartsOn, setWeekStartsOn] = useState(state!.settings.weekStartsOn);
  const [pin, setPin] = useState('');
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [feeds, setFeeds] = useState<FeedStatus[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [newCode, setNewCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [newDeviceName, setNewDeviceName] = useState('');

  useEffect(() => {
    if (isParent) get<FeedStatus[]>('/feeds/status').then(setFeeds).catch(() => {});
    if (isParent) get<DeviceInfo[]>('/devices').then(setDevices).catch(() => {});
  }, [isParent, state]);

  const removeDevice = async (d: DeviceInfo) => {
    const msg = d.current
      ? 'Disconnect THIS device? You will need a new pairing code to use it again.'
      : `Disconnect "${d.name}"? It will need a new pairing code to get back in.`;
    if (!confirm(msg)) return;
    await act(() => del(`/devices/${d.id}`), 'Disconnected');
    get<DeviceInfo[]>('/devices').then(setDevices).catch(() => {});
  };

  if (!isParent) {
    return (
      <div className="view budget locked">
        <p className="big-emoji">⚙️</p>
        <p>Settings are for parents.</p>
        <button className="btn primary big" onClick={() => requireParent()}>Enter PIN</button>
      </div>
    );
  }

  return (
    <div className="view settings">
      <div className="toolbar">
        <h2 className="toolbar-title">Settings</h2>
        <span className="spacer" />
        <button className="btn" onClick={lock}>🔒 Lock parent mode</button>
      </div>
      <div className="settings-grid">
        <section className="card">
          <h3>Family</h3>
          <div className="list">
            {state!.members.map((m) => (
              <button key={m.id} className="list-row" onClick={() => setEditing(m)}>
                <Avatar member={m} size={40} />
                <span className="list-main">
                  <strong>{m.name}</strong>
                  <span className="muted">
                    {m.role === 'parent' ? 'Parent' : 'Kid'}
                    {m.calendarFeeds.length ? ` · ${m.calendarFeeds.length} linked calendar${m.calendarFeeds.length > 1 ? 's' : ''}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => setEditing('new')}>＋ Add family member</button>
        </section>

        <section className="card">
          <h3>Display</h3>
          <label className="field">
            <span>Family name</span>
            <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
          </label>
          <label className="field">
            <span>Week starts on</span>
            <div className="seg">
              <button className={weekStartsOn === 0 ? 'on' : ''} onClick={() => setWeekStartsOn(0)}>Sunday</button>
              <button className={weekStartsOn === 1 ? 'on' : ''} onClick={() => setWeekStartsOn(1)}>Monday</button>
            </div>
          </label>
          <button className="btn primary" onClick={() => act(() => put('/settings', { familyName, weekStartsOn }), 'Saved')}>Save</button>

          <h3>Parent PIN</h3>
          {state!.settings.pinIsDefault && <p className="error">Still using the default PIN 1234.</p>}
          <div className="row">
            <input inputMode="numeric" pattern="\d*" maxLength={8} placeholder="New 4–8 digit PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <button className="btn" disabled={pin.length < 4} onClick={async () => (await act(() => put('/settings', { newPin: pin }), 'PIN changed')) && setPin('')}>
              Change PIN
            </button>
          </div>
        </section>

        <section className="card">
          <h3>Devices</h3>
          <p className="muted small">Phones, tablets and computers that can open the family calendar.</p>
          <div className="list">
            {devices.map((d) => (
              <div key={d.id} className="list-row">
                <span className="list-main">
                  <strong>{d.name}{d.current ? ' (this device)' : ''}</strong>
                  <span className="muted">Added {new Date(d.createdAt).toLocaleDateString()} · last used {new Date(d.lastSeenAt).toLocaleDateString()}</span>
                </span>
                <button className="btn danger" onClick={() => removeDevice(d)}>Disconnect</button>
              </div>
            ))}
          </div>
          {newCode ? (
            <div>
              <p>Enter this code on the new device:</p>
              <p className="device-code">{newCode.code}</p>
              <p className="muted small">Works once, until {new Date(newCode.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>
              <button className="btn" onClick={() => { setNewCode(null); get<DeviceInfo[]>('/devices').then(setDevices).catch(() => {}); }}>Done</button>
            </div>
          ) : (
            <div className="row">
              <input placeholder="Name (e.g. Mom's phone)" value={newDeviceName} maxLength={40} onChange={(e) => setNewDeviceName(e.target.value)} />
              <button className="btn" onClick={async () => {
                const r = await act(() => post<{ code: string; expiresAt: string }>('/devices/pair-code', { name: newDeviceName.trim() }));
                if (r) { setNewCode(r); setNewDeviceName(''); }
              }}>＋ Add a device</button>
            </div>
          )}
        </section>

        {feeds.length > 0 && (
          <section className="card">
            <h3>Linked calendars</h3>
            {feeds.map((f) => (
              <div key={f.url} className="feed-row">
                <span>{f.ok ? '✅' : f.fetchedAt ? '⚠️' : '⏳'}</span>
                <span className="feed-url">{state!.members.find((m) => m.id === f.memberId)?.name}: {new URL(f.url.replace(/^webcal:/, 'https:')).hostname}</span>
                <span className="muted small">{f.error ?? (f.fetchedAt ? `updated ${new Date(f.fetchedAt).toLocaleTimeString()}` : 'loading')}</span>
              </div>
            ))}
            <button className="btn" onClick={async () => { const r = await act(() => post<FeedStatus[]>('/feeds/refresh'), 'Refreshed'); if (r) setFeeds(r); }}>Refresh now</button>
          </section>
        )}
      </div>
      {editing && <MemberEditor member={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MemberEditor({ member, onClose }: { member?: Member; onClose: () => void }) {
  const act = useAction();
  const [name, setName] = useState(member?.name ?? '');
  const [emoji, setEmoji] = useState(member?.emoji ?? '🙂');
  const [color, setColor] = useState(member?.color ?? COLORS[4]);
  const [role, setRole] = useState(member?.role ?? 'kid');
  const [feeds, setFeeds] = useState((member?.calendarFeeds ?? []).join('\n'));

  const save = async () => {
    const body = { name, emoji, color, role, calendarFeeds: feeds.split('\n').map((s) => s.trim()).filter(Boolean) };
    if (await act(() => (member ? put(`/members/${member.id}`, body) : post('/members', body)), 'Saved')) onClose();
  };
  const remove = async () => {
    if (member && confirm(`Remove ${member.name} from the family display?`) && (await act(() => del(`/members/${member.id}`), 'Removed'))) onClose();
  };

  return (
    <Modal
      title={member ? `Edit ${member.name}` : 'Add family member'}
      onClose={onClose}
      footer={
        <>
          {member && <button className="btn danger" onClick={remove}>Remove</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>Save</button>
        </>
      }
    >
      <div className="row">
        <label className="field narrow">
          <span>Icon</span>
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} className="emoji-input" />
        </label>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Color</span>
        <div className="swatches">
          {COLORS.map((c) => (
            <button key={c} type="button" className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
      </label>
      <label className="field">
        <span>Role</span>
        <div className="seg">
          <button type="button" className={role === 'kid' ? 'on' : ''} onClick={() => setRole('kid')}>Kid</button>
          <button type="button" className={role === 'parent' ? 'on' : ''} onClick={() => setRole('parent')}>Parent</button>
        </div>
      </label>
      <label className="field">
        <span>Linked calendars (one iCal link per line)</span>
        <textarea rows={3} value={feeds} onChange={(e) => setFeeds(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
        <small className="muted">Google: Settings › your calendar › "Secret address in iCal format". iCloud: share calendar › Public. School calendars usually have an .ics link.</small>
      </label>
    </Modal>
  );
}
