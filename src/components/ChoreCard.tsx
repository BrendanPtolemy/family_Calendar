import { useState } from 'react';
import type { TodayChore } from '../../shared/types';
import { post } from '../api';
import { useAction, useFamily } from '../family';

export function ChoreCard({ item, color }: { item: TodayChore; color: string }) {
  const act = useAction();
  const { state } = useFamily();
  const [burst, setBurst] = useState(false);
  const { chore, memberId, completion } = item;
  const date = state?.today;

  const toggle = async () => {
    if (completion) {
      await act(() => post(`/chores/${chore.id}/undo`, { memberId, date }));
    } else {
      setBurst(true);
      window.setTimeout(() => setBurst(false), 900);
      await act(
        () => post(`/chores/${chore.id}/complete`, { memberId, date }),
        chore.needsApproval ? 'Nice! Waiting for a parent to check it.' : chore.stars ? `+${chore.stars} ⭐` : undefined,
      );
    }
  };

  const status = completion?.status === 'pending' ? 'pending' : completion ? 'done' : '';
  return (
    <button className={`chore ${status}`} style={{ '--c': color } as React.CSSProperties} onClick={toggle} aria-pressed={!!completion}>
      <span className="chore-emoji">{chore.emoji}</span>
      <span className="chore-title">{chore.title}</span>
      {chore.stars > 0 && <span className="chore-stars">{chore.stars}⭐</span>}
      <span className="chore-check">{status === 'pending' ? '⏳' : status === 'done' ? '✓' : ''}</span>
      {burst && <span className="burst" aria-hidden>✨⭐✨</span>}
    </button>
  );
}

export function Progress({ done, total, color, size = 54 }: { done: number; total: number; color: string; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <svg width={size} height={size} className="progress" aria-label={`${done} of ${total} done`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth="6" fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.26} fontWeight="700" fill="var(--ink)">
        {pct === 1 ? '🎉' : `${done}/${total}`}
      </text>
    </svg>
  );
}
