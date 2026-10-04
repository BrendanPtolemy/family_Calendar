import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  ChoreCompletion,
  Chore,
  Member,
  MemberBalance,
  Redemption,
  Reward,
  TodayChore,
} from '../shared/types';
import { get, onParentRequired, onUnpaired, post, setParentToken } from './api';

export interface FamilyState {
  today: string;
  settings: { familyName: string; pinIsDefault: boolean; weekStartsOn: 0 | 1 };
  parentUnlocked: boolean;
  members: Member[];
  chores: Chore[];
  rewards: Reward[];
  todayChores: TodayChore[];
  balances: MemberBalance[];
  streaks: Record<string, number>;
  pendingCompletions: ChoreCompletion[];
  pendingRedemptions: Redemption[];
  recentRedemptions: Redemption[];
}

interface Ctx {
  state: FamilyState | null;
  error: string | null;
  /** True when this device needs a pairing code before anything else works. */
  unpaired: boolean;
  refresh: () => Promise<void>;
  /** Bumped after any change so views refetch their own data. */
  version: number;
  member: (id: string) => Member | undefined;
  balance: (id: string) => MemberBalance | undefined;
  isParent: boolean;
  /** Ask for the PIN if needed, then run `then`. */
  requireParent: (then?: () => void) => void;
  lock: () => void;
  pinPrompt: { open: boolean; onDone?: () => void };
  closePin: () => void;
  unlocked: () => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
}

const FamilyContext = createContext<Ctx | null>(null);

export function FamilyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FamilyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unpaired, setUnpaired] = useState(false);
  const [version, setVersion] = useState(0);
  const [pinPrompt, setPinPrompt] = useState<{ open: boolean; onDone?: () => void }>({ open: false });
  const [toastMsg, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>(0);

  const refresh = useCallback(async () => {
    try {
      const s = await get<FamilyState>('/state');
      setState(s);
      setUnpaired(false);
      setError(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Keep every screen in the house in sync without websockets.
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 20_000);
    const onVis = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);

  useEffect(() => {
    onParentRequired(() => setState((s) => (s ? { ...s, parentUnlocked: false } : s)));
    onUnpaired(() => {
      setUnpaired(true);
      setState(null);
    });
  }, []);

  const toast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const value = useMemo<Ctx>(() => {
    const isParent = !!state?.parentUnlocked;
    return {
      state,
      error,
      unpaired,
      refresh,
      version,
      member: (id) => state?.members.find((m) => m.id === id),
      balance: (id) => state?.balances.find((b) => b.memberId === id),
      isParent,
      requireParent: (then) => {
        if (isParent) then?.();
        else setPinPrompt({ open: true, onDone: then });
      },
      lock: () => {
        void post('/parent/lock').catch(() => {});
        setParentToken(null);
        void refresh();
      },
      pinPrompt,
      closePin: () => setPinPrompt({ open: false }),
      unlocked: () => {
        const done = pinPrompt.onDone;
        setPinPrompt({ open: false });
        void refresh().then(() => done?.());
      },
      toast,
      toastMsg,
    };
  }, [state, error, unpaired, refresh, version, pinPrompt, toast, toastMsg]);

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

export function useFamily() {
  const ctx = useContext(FamilyContext);
  if (!ctx) throw new Error('useFamily outside FamilyProvider');
  return ctx;
}

/** Run an API action, toast its error, refresh family state. */
export function useAction() {
  const { refresh, toast } = useFamily();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (success) toast(success);
        await refresh();
        return r;
      } catch (e) {
        toast((e as Error).message);
        return undefined;
      }
    },
    [refresh, toast],
  );
}
