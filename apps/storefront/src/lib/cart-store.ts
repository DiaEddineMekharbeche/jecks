'use client';

import type { CartDto, DeliveryType } from '@jecks/shared';
import { create } from 'zustand';
import { ApiError, clientApi } from './client-api';

/**
 * Cart state — PRD F-ST-40/41.
 *
 * The store holds exactly what the server last said, and every mutation replaces the
 * whole cart with the server's answer. No client-side arithmetic: a total the browser
 * computed is a total a browser can be wrong about, and the drawer's job is to show
 * what the checkout will actually charge.
 *
 * The one piece of local optimism is `pendingLines`, which greys a row while its
 * request is in flight so the shopper sees that their click registered.
 */

interface CartState {
  cart: CartDto | null;
  loading: boolean;
  /** Set while any mutation is in flight, so buttons can disable themselves. */
  busy: boolean;
  open: boolean;
  error: string | null;
  /** Line ids currently being changed. */
  pendingLines: string[];
  /** Set briefly after an add, so the drawer can highlight what just arrived. */
  lastAddedId: string | null;

  load: () => Promise<void>;
  addItem: (variantId: string, quantity?: number) => Promise<boolean>;
  setQuantity: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  applyPromo: (code: string) => Promise<boolean>;
  removePromo: () => Promise<void>;
  setDelivery: (wilayaCode: number | null, deliveryType: DeliveryType | null) => Promise<void>;
  merge: () => Promise<void>;
  setOpen: (open: boolean) => void;
  clearError: () => void;
}

export const useCart = create<CartState>((set, get) => ({
  cart: null,
  loading: false,
  busy: false,
  open: false,
  error: null,
  pendingLines: [],
  lastAddedId: null,

  async load() {
    if (get().loading) return;
    set({ loading: true });
    try {
      const cart = await clientApi<CartDto>('/cart');
      set({ cart, error: null });
    } catch {
      // A cart that cannot be read is not worth an error banner on every page; the
      // next mutation will surface the problem where the shopper is looking.
      set({ cart: null });
    } finally {
      set({ loading: false });
    }
  },

  async addItem(variantId, quantity = 1) {
    set({ busy: true, error: null });
    try {
      const cart = await clientApi<CartDto>('/cart/items', {
        method: 'POST',
        body: { variantId, quantity },
      });
      const added = cart.items.find((item) => item.variantId === variantId);
      set({ cart, open: true, lastAddedId: added?.id ?? null });
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async setQuantity(itemId, quantity) {
    set((state) => ({ busy: true, error: null, pendingLines: [...state.pendingLines, itemId] }));
    try {
      const cart = await clientApi<CartDto>(`/cart/items/${itemId}`, {
        method: 'PATCH',
        body: { quantity },
      });
      set({ cart });
    } catch (error) {
      set({ error: messageOf(error) });
    } finally {
      set((state) => ({
        busy: false,
        pendingLines: state.pendingLines.filter((id) => id !== itemId),
      }));
    }
  },

  async removeItem(itemId) {
    set((state) => ({ busy: true, error: null, pendingLines: [...state.pendingLines, itemId] }));
    try {
      const cart = await clientApi<CartDto>(`/cart/items/${itemId}`, { method: 'DELETE' });
      set({ cart });
    } catch (error) {
      set({ error: messageOf(error) });
    } finally {
      set((state) => ({
        busy: false,
        pendingLines: state.pendingLines.filter((id) => id !== itemId),
      }));
    }
  },

  async applyPromo(code) {
    set({ busy: true, error: null });
    try {
      const cart = await clientApi<CartDto>('/cart/promo', { method: 'POST', body: { code } });
      set({ cart });
      return true;
    } catch (error) {
      // The API's message is the reason the shopper needs ("this code has expired"),
      // so it is shown verbatim rather than replaced with a generic failure.
      set({ error: messageOf(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async removePromo() {
    set({ busy: true, error: null });
    try {
      set({ cart: await clientApi<CartDto>('/cart/promo', { method: 'DELETE' }) });
    } catch (error) {
      set({ error: messageOf(error) });
    } finally {
      set({ busy: false });
    }
  },

  async setDelivery(wilayaCode, deliveryType) {
    set({ busy: true });
    try {
      set({
        cart: await clientApi<CartDto>('/cart/delivery', {
          method: 'PATCH',
          body: { wilayaCode, deliveryType },
        }),
      });
    } catch (error) {
      set({ error: messageOf(error) });
    } finally {
      set({ busy: false });
    }
  },

  async merge() {
    try {
      set({ cart: await clientApi<CartDto>('/cart/merge', { method: 'POST' }) });
    } catch {
      // Merging is a convenience; failing it must not block a sign-in.
      await get().load();
    }
  },

  setOpen(open) {
    set({ open, ...(open ? {} : { lastAddedId: null }) });
  },

  clearError() {
    set({ error: null });
  },
}));

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Une erreur est survenue. Réessayez.';
}

/** Item count for the header badge, without subscribing to the whole cart. */
export const useCartCount = (): number => useCart((state) => state.cart?.itemCount ?? 0);
