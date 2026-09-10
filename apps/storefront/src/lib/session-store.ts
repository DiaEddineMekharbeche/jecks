'use client';

import { create } from 'zustand';
import { ApiError, clientApi } from './client-api';

/**
 * Shopper session — PRD F-ST-51.
 *
 * Phone plus a one-time code; there is no password anywhere in the shopper's world.
 * The access token is stored server-side in an httpOnly cookie by the auth module, so
 * nothing here holds a credential: the store only remembers *who* is signed in, which
 * is a display concern.
 */

export interface Shopper {
  id: string;
  name: string;
  phone: string | null;
}

type Status = 'loading' | 'anonymous' | 'authenticated';

interface SessionState {
  status: Status;
  shopper: Shopper | null;
  /** Set between requesting a code and verifying it. */
  pendingPhone: string | null;
  /** Present outside production so a developer can sign in without an SMS gateway. */
  devCode: string | null;
  error: string | null;
  busy: boolean;

  load: () => Promise<void>;
  requestCode: (phone: string) => Promise<boolean>;
  verifyCode: (code: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  reset: () => void;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  shopper: null,
  pendingPhone: null,
  devCode: null,
  error: null,
  busy: false,

  async load() {
    try {
      const me = await clientApi<{ id: string; name: string; phone: string | null; type: string }>(
        '/auth/me',
      );
      if (me.type !== 'CUSTOMER') {
        set({ status: 'anonymous', shopper: null });
        return;
      }
      set({ status: 'authenticated', shopper: { id: me.id, name: me.name, phone: me.phone } });
    } catch {
      set({ status: 'anonymous', shopper: null });
    }
  },

  async requestCode(phone) {
    set({ busy: true, error: null });
    try {
      const result = await clientApi<{ devCode?: string }>('/auth/otp/request', {
        method: 'POST',
        body: { phone, purpose: 'login' },
      });
      set({ pendingPhone: phone, devCode: result?.devCode ?? null });
      return true;
    } catch (error) {
      set({ error: message(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async verifyCode(code) {
    const phone = get().pendingPhone;
    if (!phone) return false;

    set({ busy: true, error: null });
    try {
      await clientApi('/auth/otp/verify', { method: 'POST', body: { phone, code } });
      await get().load();
      // The guest basket is folded into the account's own the moment identity is known;
      // doing it later means a shopper watches items disappear and reappear.
      await clientApi('/cart/merge', { method: 'POST' }).catch(() => undefined);
      set({ pendingPhone: null, devCode: null });
      return true;
    } catch (error) {
      set({ error: message(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async signOut() {
    await clientApi('/auth/logout', { method: 'POST' }).catch(() => undefined);
    set({ status: 'anonymous', shopper: null, pendingPhone: null, devCode: null });
  },

  reset() {
    set({ pendingPhone: null, devCode: null, error: null });
  },
}));

function message(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Une erreur est survenue. Réessayez.';
}
