import { useEffect, useRef, useState } from 'react';
import { PinPad } from './components/PinPad';
import { useFamily } from './family';
import { AllowanceView } from './views/Allowance';
import { CalendarView } from './views/Calendar';
import { ChoresView } from './views/Chores';
import { GroceriesView } from './views/Groceries';
import { MealsView } from './views/Meals';
import { RewardsView } from './views/Rewards';
import { SettingsView } from './views/Settings';
import { TodayView } from './views/Today';

const TABS = [
  { id: 'today', label: 'Today', icon: '🏠' },
  { id: 'calendar', label: 'Calendar', icon: '📅' },
  { id: 'chores', label: 'Chores', icon: '✅' },
  { id: 'rewards', label: 'Rewards', icon: '⭐' },
  { id: 'meals', label: 'Meals', icon: '🍽️' },
  { id: 'groceries', label: 'Groceries', icon: '🛒' },
  { id: 'allowance', label: 'Allowance', icon: '🪙' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
] as const;

type Tab = (typeof TABS)[number]['id'];

/** Wall displays drift back to Today after a few idle minutes. */
const IDLE_MS = 3 * 60 * 1000;

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="clock">
      <span className="clock-time">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      <span className="clock-date">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>
    </div>
  );
}

export function App() {
  const { state, error, pinPrompt, toastMsg, isParent, lock, refresh } = useFamily();
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1);
    return (TABS.some((t) => t.id === h) ? h : 'today') as Tab;
  });
  const idle = useRef<number>(0);

  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  useEffect(() => {
    const reset = () => {
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(() => {
        setTab('today');
        if (isParent) lock();
      }, IDLE_MS);
    };
    reset();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => {
      window.clearTimeout(idle.current);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [isParent, lock]);

  // Roll over to the new day at midnight.
  useEffect(() => {
    const t = window.setInterval(() => {
      const d = new Date();
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (state && key !== state.today) void refresh();
    }, 60_000);
    return () => window.clearInterval(t);
  }, [state, refresh]);

  if (!state) {
    return <div className="loading">{error ? `Can't reach the family server: ${error}` : 'Loading…'}</div>;
  }

  const badge = (id: Tab) => {
    if (id === 'chores') return state.pendingCompletions.length;
    if (id === 'rewards') return state.pendingRedemptions.length;
    return 0;
  };

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">{state.settings.familyName}</div>
        {TABS.map((t) => (
          <button key={t.id} className={`nav-btn ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            <span className="nav-icon">{t.icon}</span>
            <span className="nav-label">{t.label}</span>
            {badge(t.id) > 0 && <span className="badge">{badge(t.id)}</span>}
          </button>
        ))}
        {isParent && (
          <button className="nav-btn parent-on" onClick={lock} title="Lock parent mode">
            <span className="nav-icon">🔓</span>
            <span className="nav-label">Parent</span>
          </button>
        )}
      </nav>
      <main className="main">
        <header className="topbar">
          <Clock />
          {error && <span className="offline">Offline, retrying…</span>}
        </header>
        {tab === 'today' && <TodayView go={(t) => setTab(t as Tab)} />}
        {tab === 'calendar' && <CalendarView />}
        {tab === 'chores' && <ChoresView />}
        {tab === 'rewards' && <RewardsView />}
        {tab === 'meals' && <MealsView />}
        {tab === 'groceries' && <GroceriesView />}
        {tab === 'allowance' && <AllowanceView />}
        {tab === 'settings' && <SettingsView />}
      </main>
      {pinPrompt.open && <PinPad />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
