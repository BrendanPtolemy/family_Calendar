import { useEffect, useState } from 'react';
import type { Meal, MealSlot } from '../../shared/types';
import { del, get, post, put } from '../api';
import { Modal } from '../components/Modal';
import { addDays, fmt, fromKey, startOfWeek } from '../dates';
import { useAction, useFamily } from '../family';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];
const SLOT_ICON: Record<MealSlot, string> = { breakfast: '🥞', lunch: '🥪', dinner: '🍲' };

export function MealsView() {
  const { state, version, toast } = useFamily();
  const act = useAction();
  const [weekStart, setWeekStart] = useState(startOfWeek(state!.today, state!.settings.weekStartsOn));
  const [meals, setMeals] = useState<Meal[]>([]);
  const [editing, setEditing] = useState<{ meal?: Meal; date: string; slot: MealSlot } | null>(null);
  const [tick, setTick] = useState(0);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  useEffect(() => {
    get<Meal[]>(`/meals?from=${weekStart}&to=${addDays(weekStart, 7)}`)
      .then(setMeals)
      .catch((e) => toast(e.message));
  }, [weekStart, version, tick, toast]);

  const addIngredients = async () => {
    const r = await act(() => post<{ added: number }>('/meals/add-ingredients', { from: weekStart, to: addDays(weekStart, 7) }));
    if (r) toast(r.added ? `Added ${r.added} items to the grocery list 🛒` : 'Everything is already on the list');
  };

  return (
    <div className="view meals">
      <div className="toolbar">
        <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">‹</button>
        <button className="btn" onClick={() => setWeekStart(startOfWeek(state!.today, state!.settings.weekStartsOn))}>This week</button>
        <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">›</button>
        <h2 className="toolbar-title">Meal plan · {fmt.dayMonth(weekStart)}</h2>
        <span className="spacer" />
        <button className="btn primary" onClick={addIngredients}>🛒 Add week's ingredients to groceries</button>
      </div>
      <div className="meal-grid">
        <div />
        {days.map((d) => (
          <div key={d} className={`meal-day ${d === state!.today ? 'today' : ''}`}>
            <span className="dow">{fmt.weekday(d)}</span> <span className="dnum">{fromKey(d).getDate()}</span>
          </div>
        ))}
        {SLOTS.map((slot) => (
          <Row key={slot} slot={slot} days={days} meals={meals} onPick={(date, meal) => setEditing({ date, slot, meal })} />
        ))}
      </div>
      {editing && (
        <MealEditor
          {...editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

function Row({ slot, days, meals, onPick }: { slot: MealSlot; days: string[]; meals: Meal[]; onPick: (date: string, meal?: Meal) => void }) {
  return (
    <>
      <div className="meal-slot">
        {SLOT_ICON[slot]} <span>{slot}</span>
      </div>
      {days.map((d) => {
        const meal = meals.find((m) => m.date === d && m.slot === slot);
        return (
          <button key={d} className={`meal ${meal ? 'set' : ''}`} onClick={() => onPick(d, meal)}>
            {meal ? meal.title : <span className="muted">＋</span>}
          </button>
        );
      })}
    </>
  );
}

function MealEditor({ meal, date, slot, onClose, onSaved }: { meal?: Meal; date: string; slot: MealSlot; onClose: () => void; onSaved: () => void }) {
  const act = useAction();
  const [title, setTitle] = useState(meal?.title ?? '');
  const [ingredients, setIngredients] = useState((meal?.ingredients ?? []).join('\n'));
  const save = async () => {
    const body = { date, slot, title, ingredients: ingredients.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) };
    if (await act(() => (meal ? put(`/meals/${meal.id}`, body) : post('/meals', body)), 'Saved')) onSaved();
  };
  const remove = async () => {
    if (meal && (await act(() => del(`/meals/${meal.id}`), 'Removed'))) onSaved();
  };
  return (
    <Modal
      title={`${SLOT_ICON[slot]} ${fmt.weekdayLong(date)} ${slot}`}
      onClose={onClose}
      footer={
        <>
          {meal && <button className="btn danger" onClick={remove}>Remove</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!title.trim()} onClick={save}>Save</button>
        </>
      }
    >
      <label className="field">
        <span>Meal</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tacos" />
      </label>
      <label className="field">
        <span>Ingredients (one per line)</span>
        <textarea rows={5} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
      </label>
    </Modal>
  );
}
