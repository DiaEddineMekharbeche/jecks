'use client';

import type { AnalyticsEventInput } from '@jecks/shared';
import { beacon } from './client-api';

/**
 * Server-side analytics — PRD F-AD-82.
 *
 * Events are queued in memory and flushed in batches: one request per page instead of
 * one per click, and a final `sendBeacon` on unload so the last step of a funnel is not
 * the step that is always missing.
 *
 * Nothing identifying is collected here. The session id is random per browser session
 * and never stored beyond it; the server attaches a customer id only when the shopper
 * is already signed in.
 */

const SESSION_KEY = 'jk_session';
const CONSENT_KEY = 'jk_consent';
const FLUSH_AFTER_MS = 4_000;
const MAX_BATCH = 25;

type QueuedEvent = Omit<AnalyticsEventInput, 'sessionId'> & { sessionId?: string };

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

/**
 * A session id that lives in `sessionStorage`, so it dies with the tab.
 *
 * `localStorage` would make it a persistent identifier, which is exactly what this is
 * not meant to be.
 */
export function sessionId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    // Private browsing can refuse storage; a per-page id is still better than none.
    return Math.random().toString(36).slice(2);
  }
}

export type ConsentState = 'granted' | 'denied' | 'unknown';

export function consent(): ConsentState {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const stored = window.localStorage.getItem(CONSENT_KEY);
    return stored === 'granted' || stored === 'denied' ? stored : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function setConsent(state: 'granted' | 'denied'): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, state);
  } catch {
    // Nothing to do: the banner will simply ask again next visit.
  }
  if (state === 'denied') queue = [];
  window.dispatchEvent(new CustomEvent('jk:consent', { detail: state }));
}

/**
 * Queues an event. Silently dropped when the shopper declined, which is what makes the
 * consent banner mean something rather than decorate the page.
 */
export function track(event: QueuedEvent): void {
  if (typeof window === 'undefined') return;
  if (consent() === 'denied') return;

  queue.push({
    ...event,
    sessionId: event.sessionId ?? sessionId(),
    path: event.path ?? window.location.pathname,
    device: event.device ?? deviceClass(),
    occurredAt: event.occurredAt ?? new Date(),
  });

  attachUnloadFlush();

  if (queue.length >= MAX_BATCH) {
    flush();
    return;
  }
  if (!timer) timer = setTimeout(flush, FLUSH_AFTER_MS);
}

export function flush(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;

  const events = queue.splice(0, MAX_BATCH).map((event) => ({
    ...event,
    occurredAt: event.occurredAt instanceof Date ? event.occurredAt.toISOString() : event.occurredAt,
  }));

  beacon('/events', { events });
}

function attachUnloadFlush(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  // `visibilitychange` fires on mobile where `beforeunload` frequently does not.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

function deviceClass(): 'mobile' | 'tablet' | 'desktop' {
  const width = window.innerWidth;
  if (width < 640) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}
