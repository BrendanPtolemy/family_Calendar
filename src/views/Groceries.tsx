import { useEffect, useState } from 'react';
import type { GroceryItem } from '../../shared/types';
import { del, get, patch, post } from '../api';
import { useAction, useFamily } from '../family';

export function GroceriesView() {
  const { version, toast } = useFamily();
  const act = useAction();
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [name, setName] = useState('');
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    get<GroceryItem[]>('/groceries').then(setItems).catch((e) => toast(e.message));
  }, [version, tick, toast]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setName('');
    await act(() => post('/groceries', { name: n }));
    reload();
  };

  const toggle = async (g: GroceryItem) => {
    setItems((list) => list.map((x) => (x.id === g.id ? { ...x, checked: !x.checked } : x)));
    await act(() => patch(`/groceries/${g.id}`, { checked: !g.checked }));
    reload();
  };

  const open = items.filter((g) => !g.checked);
  const checked = items.filter((g) => g.checked);
  const groups = new Map<string, GroceryItem[]>();
  for (const g of open) {
    const k = g.category || 'Other';
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }

  return (
    <div className="view groceries">
      <div className="toolbar">
        <h2 className="toolbar-title">Grocery list</h2>
        <span className="muted">{open.length} to get</span>
        <span className="spacer" />
        {checked.length > 0 && (
          <button className="btn" onClick={async () => { await act(() => post('/groceries/clear-checked'), 'Cleared'); reload(); }}>
            Clear {checked.length} checked
          </button>
        )}
      </div>
      <form className="add-row" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add an item…" enterKeyHint="done" />
        <button className="btn primary" disabled={!name.trim()}>Add</button>
      </form>
      <div className="grocery-groups">
        {[...groups.entries()].map(([cat, list]) => (
          <section key={cat} className="card grocery-group">
            <h3>{cat}</h3>
            {list.map((g) => (
              <Row key={g.id} g={g} onToggle={() => toggle(g)} onDelete={async () => { await act(() => del(`/groceries/${g.id}`)); reload(); }} />
            ))}
          </section>
        ))}
        {checked.length > 0 && (
          <section className="card grocery-group done">
            <h3>In the cart</h3>
            {checked.map((g) => (
              <Row key={g.id} g={g} onToggle={() => toggle(g)} onDelete={async () => { await act(() => del(`/groceries/${g.id}`)); reload(); }} />
            ))}
          </section>
        )}
        {!items.length && <p className="empty">The list is empty 🎉</p>}
      </div>
    </div>
  );
}

function Row({ g, onToggle, onDelete }: { g: GroceryItem; onToggle: () => void; onDelete: () => void }) {
  return (
    <div className={`grocery ${g.checked ? 'checked' : ''}`}>
      <button className="grocery-main" onClick={onToggle}>
        <span className="box">{g.checked ? '✓' : ''}</span>
        <span className="grocery-name">{g.name}</span>
        {g.quantity && <span className="muted">{g.quantity}</span>}
      </button>
      <button className="icon-btn small" onClick={onDelete} aria-label={`Remove ${g.name}`}>✕</button>
    </div>
  );
}
