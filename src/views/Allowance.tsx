import { useEffect, useState } from 'react';
import type { AllowanceAndGoals, IntegrationInfo, Member } from '../../shared/types';
import { get } from '../api';
import { Avatar } from '../components/Avatar';
import { fmt } from '../dates';
import { useFamily } from '../family';

const HOW_OFTEN: Record<string, string> = {
  weekly: 'every week',
  biweekly: 'every 2 weeks',
  monthly: 'every month',
  quarterly: 'every 3 months',
  semiannual: 'twice a year',
  annual: 'every year',
};

export function AllowanceView() {
  const { state, version } = useFamily();
  const [data, setData] = useState<AllowanceAndGoals | null>(null);
  const [info, setInfo] = useState<IntegrationInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get<IntegrationInfo>('/integration').then(setInfo).catch(() => {});
    get<AllowanceAndGoals>('/allowance')
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [version]);

  const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: data?.currency ?? 'USD', minimumFractionDigits: n % 1 ? 2 : 0 });
  const memberFor = (who?: string, text = ''): Member | undefined => {
    const members = state?.members ?? [];
    if (who) return members.find((m) => m.name.toLowerCase() === who.toLowerCase());
    return members.find((m) => new RegExp(`\\b${m.name}\\b`, 'i').test(text));
  };

  return (
    <div className="view allowance">
      <div className="toolbar">
        <h2 className="toolbar-title">Allowance & savings</h2>
        <span className="spacer" />
        {info?.message && <span className="muted">{info.message}</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {data && (
        <div className="budget-grid">
          <section className="card">
            <h3>Allowance</h3>
            {data.allowances.length === 0 && <p className="muted">No allowances set up in the budget app yet.</p>}
            <div className="list">
              {data.allowances.map((a) => {
                const m = memberFor(a.who, a.name);
                return (
                  <div key={a.name} className="list-row static">
                    {m ? <Avatar member={m} size={44} /> : <span className="list-emoji">🪙</span>}
                    <span className="list-main">
                      <strong>{m?.name ?? a.who ?? a.name}</strong>
                      <span className="muted">
                        {money(a.amount)} {HOW_OFTEN[a.frequency] ?? a.frequency}
                      </span>
                    </span>
                    {a.nextDue && (
                      <span className="next-pay">
                        <span className="muted small">Next</span>
                        <strong>{fmt.dayMonth(a.nextDue)}</strong>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          <section className="card">
            <h3>Savings goals</h3>
            {data.goals.length === 0 && <p className="muted">No savings goals yet.</p>}
            {data.goals.map((g) => {
              const m = memberFor(g.who, g.name);
              const pct = g.target ? Math.min(100, (g.saved / g.target) * 100) : 0;
              return (
                <div key={g.name} className="budget-row">
                  <div className="budget-label">
                    <strong>
                      {m ? `${m.emoji} ` : ''}
                      {g.name}
                    </strong>
                    <span className="muted">{Math.round(pct)}%</span>
                  </div>
                  <div className="bar goal">
                    <span style={{ width: `${pct}%`, background: m?.color }} />
                  </div>
                  <div className="muted small">
                    {money(g.saved)} of {money(g.target)}
                    {g.targetDate ? ` · by ${fmt.dayMonth(g.targetDate)}` : ''}
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}
