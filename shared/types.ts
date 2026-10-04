// Types shared by the server and the web app.

export type Role = 'parent' | 'kid';

export interface Member {
  id: string;
  name: string;
  color: string; // hex, used for calendar + chore columns
  emoji: string;
  role: Role;
  /** Subscribed calendar feeds (Google/iCloud/Outlook "secret iCal address"). */
  calendarFeeds: string[];
}

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO datetime, or YYYY-MM-DD when allDay
  end: string; // ISO datetime, or YYYY-MM-DD (exclusive) when allDay
  allDay: boolean;
  memberIds: string[];
  location?: string;
  notes?: string;
  recurrence: Recurrence;
  recurrenceUntil?: string; // YYYY-MM-DD
}

/** An event as shown on the calendar: one concrete occurrence. */
export interface EventOccurrence extends CalendarEvent {
  occurrenceId: string;
  source: 'family' | 'feed';
  readOnly: boolean;
  /** For repeating family events: the first occurrence, which is what gets edited. */
  seriesStart?: string;
  seriesEnd?: string;
}

export type ChoreSchedule =
  | { type: 'daily' }
  | { type: 'weekly'; days: number[] } // 0 = Sunday
  | { type: 'once'; date: string };

export interface Chore {
  id: string;
  title: string;
  emoji: string;
  assigneeIds: string[];
  stars: number;
  schedule: ChoreSchedule;
  /** If true, a parent must approve before stars count. */
  needsApproval: boolean;
  archived: boolean;
}

export interface ChoreCompletion {
  id: string;
  choreId: string;
  memberId: string;
  date: string; // YYYY-MM-DD the chore was due
  status: 'pending' | 'approved';
  stars: number; // snapshot at completion time
  at: string;
}

export type RewardKind = 'screen_time' | 'privilege' | 'activity' | 'treat';

export interface Reward {
  id: string;
  title: string;
  emoji: string;
  cost: number; // stars
  kind: RewardKind;
  /** For screen_time rewards: minutes added to the member's screen-time bank. */
  screenMinutes?: number;
  archived: boolean;
}

export interface Redemption {
  id: string;
  rewardId: string;
  memberId: string;
  cost: number;
  screenMinutes: number;
  status: 'requested' | 'approved' | 'denied';
  at: string;
}

export interface ScreenTimeUse {
  id: string;
  memberId: string;
  minutes: number;
  at: string;
}

export interface MemberBalance {
  memberId: string;
  starsEarned: number;
  starsPending: number;
  starsSpent: number;
  starsAvailable: number;
  screenMinutesBanked: number;
}

export interface TodayChore {
  chore: Chore;
  memberId: string;
  completion?: ChoreCompletion;
}

// ---- Budget / groceries / meals (provided by the budget integration) ----

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Meal {
  id: string;
  date: string; // YYYY-MM-DD
  slot: MealSlot;
  title: string;
  ingredients: string[];
  notes?: string;
}

export interface GroceryItem {
  id: string;
  name: string;
  quantity?: string;
  category?: string;
  checked: boolean;
  addedBy?: string;
}

// Only allowance and savings goals come across from the budget app.
// Budget categories and spending deliberately stay out of the family display.

export interface Allowance {
  name: string;
  /** Family member's name as the budget app knows it. */
  who?: string;
  amount: number;
  frequency: string; // weekly, biweekly, monthly…
  nextDue?: string; // YYYY-MM-DD
}

export interface SavingsGoal {
  name: string;
  who?: string;
  target: number;
  saved: number;
  targetDate?: string;
}

export interface AllowanceAndGoals {
  currency: string;
  allowances: Allowance[];
  goals: SavingsGoal[];
}

export interface IntegrationInfo {
  provider: string;
  connected: boolean;
  readOnly: boolean;
  message?: string;
  /** False when ingredients come from saved recipes rather than being typed per meal. */
  mealIngredientsEditable: boolean;
}
