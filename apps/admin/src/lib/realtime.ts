import type { AdminEvent, AdminEventName } from '@jecks/shared';
import { format, money } from '@jecks/shared';
import { notify } from '@jecks/ui';
import { useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { useEffect, useRef } from 'react';
import { DEFAULT_TONE, isToneId, playTone, type ToneId } from './alert-sound';
import { getAccessToken } from './api';

/**
 * Live admin updates over SSE — DECISIONS D12.
 *
 * `EventSource` cannot carry an Authorization header, so the stream is read with fetch
 * and the body is parsed as it arrives. That also gives us control over reconnection,
 * which matters: a naive retry loop against a restarting API is a self-inflicted
 * denial of service.
 */

interface RealtimeState {
  status: 'idle' | 'connecting' | 'open' | 'closed';
  lastEventAt: string | null;
  /** Unseen counts per nav badge, cleared when the operator opens the module. */
  unseen: Record<string, number>;
  soundEnabled: boolean;
  soundTone: ToneId;
  /** The browser refused the last sound: nobody has clicked on this page yet. */
  soundBlocked: boolean;
  setStatus: (status: RealtimeState['status']) => void;
  bump: (module: string) => void;
  clearUnseen: (module: string) => void;
  toggleSound: () => void;
  setTone: (tone: ToneId) => void;
  setSoundBlocked: (blocked: boolean) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  status: 'idle',
  lastEventAt: null,
  unseen: {},
  soundEnabled: readSoundPreference(),
  soundTone: readTonePreference(),
  soundBlocked: false,

  setStatus: (status) => set({ status }),
  bump: (module) =>
    set((state) => ({
      lastEventAt: new Date().toISOString(),
      unseen: { ...state.unseen, [module]: (state.unseen[module] ?? 0) + 1 },
    })),
  clearUnseen: (module) =>
    set((state) => {
      const next = { ...state.unseen };
      delete next[module];
      return { unseen: next };
    }),
  toggleSound: () =>
    set((state) => {
      const soundEnabled = !state.soundEnabled;
      try {
        localStorage.setItem('jk-admin-sound', String(soundEnabled));
      } catch {
        // Private browsing: the toggle still holds for this session.
      }
      return { soundEnabled };
    }),
  setTone: (soundTone) => {
    try {
      localStorage.setItem('jk-admin-tone', soundTone);
    } catch {
      // Private browsing: the choice holds for this session.
    }
    set({ soundTone });
  },
  setSoundBlocked: (soundBlocked) => set({ soundBlocked }),
}));

function readSoundPreference(): boolean {
  try {
    // On until somebody turns it off. A shop that wants to know about an order the moment
    // it arrives should not have to find a switch first; one that does not can mute it.
    return localStorage.getItem('jk-admin-sound') !== 'false';
  } catch {
    return true;
  }
}

function readTonePreference(): ToneId {
  try {
    const stored = localStorage.getItem('jk-admin-tone');
    return isToneId(stored) ? stored : DEFAULT_TONE;
  } catch {
    return DEFAULT_TONE;
  }
}

export type RealtimeHandler = (event: AdminEvent) => void;

const handlers = new Set<RealtimeHandler>();

/** Subscribe a component to the stream; returns the unsubscribe function. */
export function onAdminEvent(handler: RealtimeHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Which nav badge an event increments. */
const EVENT_MODULE: Partial<Record<AdminEventName, string>> = {
  'order.created': 'orders',
  'order.transitioned': 'orders',
  'shipment.updated': 'delivery',
  'inventory.low': 'inventory',
  notification: 'notifications',
};

/**
 * Opens the stream for as long as the admin is mounted. Reconnects with exponential
 * backoff, capped, so a restarting API is retried patiently rather than hammered.
 */
export function useAdminEventStream(enabled: boolean): void {
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const store = useRealtimeStore.getState();

    async function connect(): Promise<void> {
      if (cancelled) return;
      store.setStatus('connecting');

      const controller = new AbortController();
      abortRef.current = controller;
      const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
      const token = getAccessToken();

      try {
        const response = await fetch(`${base}/admin/events`, {
          credentials: 'include',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);

        useRealtimeStore.getState().setStatus('open');
        attempt = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line; anything after the last one is
          // a partial frame and must stay in the buffer.
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const event = parseFrame(frame);
            if (event) dispatch(event, queryClient);
          }
        }
      } catch {
        // Aborting on unmount lands here too; `cancelled` tells the two apart.
      }

      if (cancelled) return;
      useRealtimeStore.getState().setStatus('closed');

      attempt += 1;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
      timer = setTimeout(() => void connect(), delay);
    }

    void connect();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      abortRef.current?.abort();
      useRealtimeStore.getState().setStatus('idle');
    };
  }, [enabled, queryClient]);
}

function parseFrame(frame: string): AdminEvent | null {
  let name = 'message';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }

  if (dataLines.length === 0) return null;

  try {
    const payload = JSON.parse(dataLines.join('\n')) as AdminEvent;
    // Nest sends the whole envelope as data for our events; heartbeats send a bare
    // object, so normalize both into the same shape.
    return payload.name
      ? payload
      : { name: name as AdminEventName, id: '', at: new Date().toISOString(), payload };
  } catch {
    return null;
  }
}

function dispatch(event: AdminEvent, queryClient: ReturnType<typeof useQueryClient>): void {
  if (event.name === 'ping' || event.name === 'connected') return;

  const module = EVENT_MODULE[event.name];
  if (module) useRealtimeStore.getState().bump(module);

  // Lists refetch on their own schedule; an event just marks them stale so the next
  // render pulls fresh rows without a full page reload.
  if (event.name.startsWith('order.')) {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }
  if (event.name === 'shipment.updated') {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'shipments'] });
  }
  if (event.name === 'inventory.low') {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'inventory'] });
  }

  if (event.name === 'order.created') announceNewOrder(event);

  for (const handler of handlers) handler(event);
}

/** The chime and the toast for an order that has just been placed. */
function announceNewOrder(event: AdminEvent): void {
  const { soundEnabled, soundTone, setSoundBlocked } = useRealtimeStore.getState();
  const order = event.payload as { number?: string; totalMinor?: string; customerName?: string };

  const amount = order.totalMinor
    ? format(money(BigInt(order.totalMinor)), { locale: 'fr-DZ' })
    : '';
  notify.info(`Nouvelle commande ${order.number ?? ''}`.trim(), {
    description: [order.customerName, amount].filter(Boolean).join(' · ') || undefined,
    duration: 10_000,
  });

  if (soundEnabled) void playTone(soundTone).then((played) => setSoundBlocked(!played));
}
