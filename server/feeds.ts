// Read-only calendar subscriptions (Google, iCloud, Outlook, school calendars…)
// via their iCal (.ics) links. Feeds are fetched in the background and cached;
// the calendar view never waits on the network.

import ical, { type CalendarResponse, type VEvent } from 'node-ical';
import type { EventOccurrence } from '../shared/types.js';
import { toDateKey } from './domain.js';

interface FeedCache {
  fetchedAt: number;
  error?: string;
  data?: CalendarResponse;
}

export interface FeedStatus {
  url: string;
  memberId: string;
  ok: boolean;
  fetchedAt?: string;
  error?: string;
}

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'val' in (v as object)) return String((v as { val: unknown }).val);
  return String(v);
}

export class FeedService {
  private cache = new Map<string, FeedCache>();
  private inflight = new Map<string, Promise<void>>();

  constructor(
    private refreshMs: number,
    private load: (url: string) => Promise<CalendarResponse> = (url) => ical.async.fromURL(url),
  ) {}

  /** Refresh any feed whose cache is stale. Resolves when all are done. */
  async refresh(urls: string[], force = false): Promise<void> {
    await Promise.all(urls.map((u) => this.refreshOne(u, force)));
  }

  private refreshOne(url: string, force: boolean): Promise<void> {
    const c = this.cache.get(url);
    if (!force && c && Date.now() - c.fetchedAt < this.refreshMs) return Promise.resolve();
    const running = this.inflight.get(url);
    if (running) return running;
    const p = this.load(url.replace(/^webcal:/, 'https:'))
      .then((data) => {
        this.cache.set(url, { fetchedAt: Date.now(), data });
      })
      .catch((e: Error) => {
        // Keep serving the last good copy if there is one.
        this.cache.set(url, { fetchedAt: Date.now(), data: c?.data, error: e.message });
      })
      .finally(() => this.inflight.delete(url));
    this.inflight.set(url, p);
    return p;
  }

  status(feeds: { url: string; memberId: string }[]): FeedStatus[] {
    return feeds.map(({ url, memberId }) => {
      const c = this.cache.get(url);
      return {
        url,
        memberId,
        ok: !!c && !c.error,
        fetchedAt: c ? new Date(c.fetchedAt).toISOString() : undefined,
        error: c?.error,
      };
    });
  }

  /** Occurrences from cached feeds overlapping [from, to). */
  occurrences(feeds: { url: string; memberId: string }[], from: Date, to: Date): EventOccurrence[] {
    const out: EventOccurrence[] = [];
    // Inclusive `to` in node-ical; nudge back so [from, to) holds.
    const toIncl = new Date(to.getTime() - 1);
    feeds.forEach(({ url, memberId }, feedIndex) => {
      const data = this.cache.get(url)?.data;
      if (!data) return;
      for (const comp of Object.values(data)) {
        const ev = comp as VEvent;
        if (!ev || typeof ev !== 'object' || ev.type !== 'VEVENT') continue;
        if (!ev.start) continue;
        let instances: { start: Date; end: Date; isFullDay: boolean; summary: unknown; event: VEvent }[];
        try {
          instances = ical.expandRecurringEvent(ev, { from, to: toIncl, expandOngoing: true });
        } catch {
          continue;
        }
        for (const inst of instances) {
          const end = inst.end ?? inst.start;
          if (end.getTime() <= from.getTime() && inst.start.getTime() < from.getTime()) continue;
          const allDay = inst.isFullDay;
          out.push({
            id: `feed:${feedIndex}:${ev.uid}`,
            occurrenceId: `feed:${feedIndex}:${ev.uid}:${inst.start.getTime()}`,
            title: text(inst.summary) || 'Busy',
            start: allDay ? toDateKey(inst.start) : inst.start.toISOString(),
            end: allDay ? toDateKey(end) : end.toISOString(),
            allDay,
            memberIds: [memberId],
            location: text(inst.event.location) || undefined,
            recurrence: 'none',
            source: 'feed',
            readOnly: true,
          });
        }
      }
    });
    return out;
  }
}
