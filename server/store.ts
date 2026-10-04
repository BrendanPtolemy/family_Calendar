// Tiny JSON-file database. One household, a few thousand records at most,
// so the whole thing lives in memory and is written atomically on change.

import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  CalendarEvent,
  Chore,
  ChoreCompletion,
  GroceryItem,
  Meal,
  Member,
  Redemption,
  Reward,
  ScreenTimeUse,
} from '../shared/types.js';
import { buildSeed } from './seed.js';

export interface Settings {
  familyName: string;
  pinSalt: string;
  pinHash: string;
  /** True until a parent changes the default PIN. */
  pinIsDefault: boolean;
  weekStartsOn: 0 | 1;
}

export interface Data {
  version: 1;
  settings: Settings;
  members: Member[];
  events: CalendarEvent[];
  chores: Chore[];
  completions: ChoreCompletion[];
  rewards: Reward[];
  redemptions: Redemption[];
  screenUses: ScreenTimeUse[];
  /** Used only by the sample budget provider. */
  sample: { meals: Meal[]; groceries: GroceryItem[] };
}

export const newId = () => randomUUID();

export function hashPin(pin: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${pin}`).digest('hex');
}

export function makePinSettings(pin: string): Pick<Settings, 'pinSalt' | 'pinHash'> {
  const pinSalt = randomBytes(16).toString('hex');
  return { pinSalt, pinHash: hashPin(pin, pinSalt) };
}

export class Store {
  data: Data;
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string | null) {
    if (file && existsSync(file)) {
      this.data = JSON.parse(readFileSync(file, 'utf8')) as Data;
    } else {
      this.data = buildSeed(new Date());
      this.flush();
    }
  }

  /** Mutate data and schedule a save. */
  update<T>(fn: (d: Data) => T): T {
    const result = fn(this.data);
    this.scheduleSave();
    return result;
  }

  private scheduleSave() {
    if (!this.file) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 100);
  }

  flush() {
    if (!this.file) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }
}
