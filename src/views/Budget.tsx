import { useEffect, useState } from 'react';
import type { BudgetSummary, IntegrationInfo } from '../../shared/types';
import { get } from '../api';
import { useFamily } from '../family';

export function BudgetView() {
  const { isParent, requireParent, version } = useFamily();
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [info, setInfo] = useState<IntegrationInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get<IntegrationInfo>('/integration').then(setInfo).catch(() => {});
    if (!isParent) return;
    get<BudgetSummary>('/budget')
      .then((s) => {
        setSummary(s);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [isParent, version]);

  if (!isParent) {
    return (
      <div className="view budget locked">
        <p className="big-emoji">🔒</p>
        <p>The family budget is for parents.</p>
        <button className="btn primary big" onClick={() => requireParent()}>Enter PIN</button>
      </div>
    );
  }

  const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: summary?.currency ?? 'USD', maximumFractionDigits: 0 });

  return (
    <div className="view budget">
      <div className="toolbar">
        <h2 className="toolbar-title">Budget · {summary?.period}</h2>
        <span className="spacer" />
        {info?.message && <span className="muted">{info.message}</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {summary && (
        <div className="budget-grid">
          <section className="card">
            <h3>This month</h3>
            {summary.categories.map((c) => {
              const pct = c.budgeted ? (c.spent / c.budgeted) * 100 : 0;
              const left = c.budgeted - c.spent;
              return (
                <div key={c.name} className="budget-row">
                  <div className="budget-label">
                    <strong>{c.name}</strong>
                    <span className={left < 0 ? 'over' : 'muted'}>{left < 0 ? `${money(-left)} over` : `${money(left)} left`}</span>
                  </div>
                  <div className="bar">
                    <span className={pct > 100 ? 'over' : pct > 85 ? 'warn' : ''} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <div className="muted small">
                    {money(c.spent)} of {money(c.budgeted)}
                  </div>
                </div>
              );
            })}
          </section>
          {summary.goals.length > 0 && (
            <section className="card">
              <h3>Family goals</h3>
              {summary.goals.map((g) => (
                <div key={g.name} className="budget-row">
                  <div className="budget-label">
                    <strong>{g.name}</strong>
                    <span className="muted">{Math.round((g.saved / g.target) * 100)}%</span>
                  </div>
                  <div className="bar goal">
                    <span style={{ width: `${Math.min(100, (g.saved / g.target) * 100)}%` }} />
                  </div>
                  <div className="muted small">
                    {money(g.saved)} of {money(g.target)}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
