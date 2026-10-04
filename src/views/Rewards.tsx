import { useState } from 'react';
import type { Reward, RewardKind } from '../../shared/types';
import { del, post, put } from '../api';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { useAction, useFamily } from '../family';

const KIND_LABEL: Record<RewardKind, string> = {
  screen_time: 'Screen time',
  privilege: 'Privilege',
  activity: 'Activity',
  treat: 'Treat',
};

export function RewardsView() {
  const { state, isParent, requireParent, member, balance } = useFamily();
  const act = useAction();
  const s = state!;
  const earners = s.members.filter((m) => m.role === 'kid' || (balance(m.id)?.starsEarned ?? 0) > 0);
  const [who, setWho] = useState(earners[0]?.id ?? '');
  const [confirming, setConfirming] = useState<Reward | null>(null);
  const [useMinutes, setUseMinutes] = useState<string | null>(null);
  const [editing, setEditing] = useState<Reward | 'new' | null>(null);
  const [managing, setManaging] = useState(false);
  const [bonusFor, setBonusFor] = useState<string | null>(null);

  const me = member(who);
  const bal = balance(who);
  const rewardName = (id: string) => s.rewards.find((r) => r.id === id);

  return (
    <div className="view rewards">
      <div className="toolbar">
        <h2 className="toolbar-title">Rewards</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => requireParent(() => setManaging(true))}>🔒 Manage rewards</button>
      </div>

      <div className="earners">
        {earners.map((m) => {
          const b = balance(m.id);
          return (
            <button key={m.id} className={`earner ${who === m.id ? 'on' : ''}`} style={{ '--c': m.color } as React.CSSProperties} onClick={() => setWho(m.id)}>
              <Avatar member={m} size={52} />
              <span className="earner-name">{m.name}</span>
              <span className="earner-stars">{b?.starsAvailable ?? 0} ⭐</span>
              {(b?.starsPending ?? 0) > 0 && <span className="muted small">+{b?.starsPending} waiting</span>}
              {(b?.screenMinutesBanked ?? 0) > 0 && <span className="screen-bank">📱 {b?.screenMinutesBanked} min</span>}
            </button>
          );
        })}
      </div>

      {isParent && s.pendingRedemptions.length > 0 && (
        <div className="card approvals">
          <h3>Reward requests</h3>
          {s.pendingRedemptions.map((r) => {
            const m = member(r.memberId);
            const rw = rewardName(r.rewardId);
            return (
              <div key={r.id} className="approval-row">
                {m && <Avatar member={m} size={36} />}
                <span>
                  <strong>{m?.name}</strong> wants {rw?.emoji} {rw?.title} <span className="muted">({r.cost}⭐)</span>
                </span>
                <span className="spacer" />
                <button className="btn" onClick={() => act(() => post(`/redemptions/${r.id}/deny`), 'Stars returned')}>Not now</button>
                <button className="btn primary" onClick={() => act(() => post(`/redemptions/${r.id}/approve`), 'Approved 🎉')}>Approve</button>
              </div>
            );
          })}
        </div>
      )}

      {me && (
        <>
          {(bal?.screenMinutesBanked ?? 0) > 0 && (
            <div className="card screen-card" style={{ '--c': me.color } as React.CSSProperties}>
              <span className="big-emoji">📱</span>
              <div>
                <strong>{bal!.screenMinutesBanked} minutes</strong> of screen time saved up
              </div>
              <span className="spacer" />
              <button className="btn" onClick={() => requireParent(() => setUseMinutes(me.id))}>Start screen time</button>
            </div>
          )}
          <div className="reward-grid">
            {s.rewards.map((r) => {
              const short = (bal?.starsAvailable ?? 0) < r.cost;
              return (
                <button key={r.id} className={`reward ${short ? 'short' : ''}`} onClick={() => setConfirming(r)}>
                  <span className="reward-emoji">{r.emoji}</span>
                  <span className="reward-title">{r.title}</span>
                  <span className="reward-cost">{r.cost} ⭐</span>
                  {short ? (
                    <span className="reward-need">{r.cost - (bal?.starsAvailable ?? 0)} more to go</span>
                  ) : (
                    <span className="reward-need ready">Ready!</span>
                  )}
                  <span className="reward-bar">
                    <span style={{ width: `${Math.min(100, ((bal?.starsAvailable ?? 0) / r.cost) * 100)}%`, background: me.color }} />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {confirming && me && (
        <Modal
          title={`${confirming.emoji} ${confirming.title}`}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <span className="spacer" />
              <button className="btn" onClick={() => setConfirming(null)}>Cancel</button>
              <button
                className="btn primary"
                disabled={(bal?.starsAvailable ?? 0) < confirming.cost}
                onClick={async () => {
                  const r = await act(
                    () => post(`/rewards/${confirming.id}/redeem`, { memberId: me.id }),
                    isParent ? 'Enjoy! 🎉' : 'Asked a parent 🙏',
                  );
                  if (r) setConfirming(null);
                }}
              >
                {isParent ? `Give to ${me.name}` : 'Ask a parent'}
              </button>
            </>
          }
        >
          <p>
            This costs <strong>{confirming.cost} ⭐</strong>. {me.name} has <strong>{bal?.starsAvailable ?? 0} ⭐</strong>.
          </p>
          {!isParent && <p className="muted">A parent will see the request and say yes or not now. If it's a no, the stars come back.</p>}
        </Modal>
      )}

      {useMinutes && <UseScreenTime memberId={useMinutes} onClose={() => setUseMinutes(null)} />}

      {managing && (
        <Modal
          title="Manage rewards"
          wide
          onClose={() => setManaging(false)}
          footer={
            <>
              <button className="btn" onClick={() => setBonusFor(who)}>🌟 Give bonus stars</button>
              <span className="spacer" />
              <button className="btn primary" onClick={() => setEditing('new')}>＋ New reward</button>
            </>
          }
        >
          <div className="list">
            {s.rewards.map((r) => (
              <button key={r.id} className="list-row" onClick={() => setEditing(r)}>
                <span className="list-emoji">{r.emoji}</span>
                <span className="list-main">
                  <strong>{r.title}</strong>
                  <span className="muted">
                    {KIND_LABEL[r.kind]}
                    {r.screenMinutes ? ` · ${r.screenMinutes} min` : ''} · {r.cost}⭐
                  </span>
                </span>
              </button>
            ))}
          </div>
          {s.recentRedemptions.length > 0 && (
            <>
              <h3>Recently</h3>
              <ul className="history">
                {s.recentRedemptions.map((r) => (
                  <li key={r.id}>
                    {member(r.memberId)?.name}: {rewardName(r.rewardId)?.title} <span className="muted">({r.status}, {new Date(r.at).toLocaleDateString()})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Modal>
      )}
      {editing && <RewardEditor reward={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {bonusFor && <BonusStars defaultMember={bonusFor} onClose={() => setBonusFor(null)} />}
    </div>
  );
}

function UseScreenTime({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const { member, balance } = useFamily();
  const act = useAction();
  const banked = balance(memberId)?.screenMinutesBanked ?? 0;
  const options = [15, 30, 45, 60].filter((m) => m <= banked);
  if (!options.includes(banked)) options.push(banked);
  return (
    <Modal title={`Screen time for ${member(memberId)?.name}`} onClose={onClose}>
      <p>{banked} minutes saved. How much is being used now?</p>
      <div className="chips">
        {options.map((m) => (
          <button key={m} className="btn big" onClick={async () => (await act(() => post('/screen-time/use', { memberId, minutes: m }), `Enjoy ${m} minutes! 📱`)) && onClose()}>
            {m} min
          </button>
        ))}
      </div>
    </Modal>
  );
}

function BonusStars({ defaultMember, onClose }: { defaultMember: string; onClose: () => void }) {
  const { state } = useFamily();
  const act = useAction();
  const [memberId, setMemberId] = useState(defaultMember);
  const [stars, setStars] = useState(2);
  const [reason, setReason] = useState('Great attitude');
  return (
    <Modal
      title="Bonus stars"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn primary" onClick={async () => (await act(() => post('/stars/adjust', { memberId, stars, reason }), 'Stars given 🌟')) && onClose()}>
            Give {stars} ⭐
          </button>
        </>
      }
    >
      <div className="member-picker">
        {state!.members.map((m) => (
          <button key={m.id} type="button" className={`member-pick ${memberId === m.id ? 'on' : ''}`} style={{ '--c': m.color } as React.CSSProperties} onClick={() => setMemberId(m.id)}>
            {m.emoji} {m.name}
          </button>
        ))}
      </div>
      <div className="row">
        <label className="field narrow">
          <span>Stars</span>
          <input type="number" min={-100} max={100} value={stars} onChange={(e) => setStars(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>For</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

function RewardEditor({ reward, onClose }: { reward?: Reward; onClose: () => void }) {
  const act = useAction();
  const [title, setTitle] = useState(reward?.title ?? '');
  const [emoji, setEmoji] = useState(reward?.emoji ?? '🎁');
  const [cost, setCost] = useState(reward?.cost ?? 5);
  const [kind, setKind] = useState<RewardKind>(reward?.kind ?? 'privilege');
  const [screenMinutes, setMinutes] = useState(reward?.screenMinutes ?? 30);
  const save = async () => {
    const body = { title, emoji, cost, kind, screenMinutes };
    if (await act(() => (reward ? put(`/rewards/${reward.id}`, body) : post('/rewards', body)), 'Saved')) onClose();
  };
  const remove = async () => {
    if (reward && confirm(`Remove "${reward.title}"?`) && (await act(() => del(`/rewards/${reward.id}`), 'Removed'))) onClose();
  };
  return (
    <Modal
      title={reward ? 'Edit reward' : 'New reward'}
      onClose={onClose}
      footer={
        <>
          {reward && <button className="btn danger" onClick={remove}>Remove</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!title.trim()} onClick={save}>Save</button>
        </>
      }
    >
      <div className="row">
        <label className="field narrow">
          <span>Icon</span>
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} className="emoji-input" />
        </label>
        <label className="field">
          <span>Reward</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pick the weekend hike" />
        </label>
        <label className="field narrow">
          <span>Cost ⭐</span>
          <input type="number" min={1} max={1000} value={cost} onChange={(e) => setCost(Number(e.target.value))} />
        </label>
      </div>
      <label className="field">
        <span>Type</span>
        <div className="seg">
          {(Object.keys(KIND_LABEL) as RewardKind[]).map((k) => (
            <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </label>
      {kind === 'screen_time' && (
        <label className="field narrow">
          <span>Minutes</span>
          <input type="number" min={1} max={600} value={screenMinutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
      )}
    </Modal>
  );
}
