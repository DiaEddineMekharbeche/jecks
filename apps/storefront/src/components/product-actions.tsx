'use client';

import { isValidDzPhone, type Locale } from '@jecks/shared';
import { Button } from '@jecks/ui';
import { Check, Heart, Loader2, Share2 } from 'lucide-react';
import { useState } from 'react';
import { track } from '@/lib/analytics';
import { useCart } from '@/lib/cart-store';
import { clientApi, errorMessage } from '@/lib/client-api';
import type { Dictionary } from '@/lib/dictionary';

/**
 * The buy row of the product page — PRD F-ST-33, F-ST-32, F-ST-31.
 *
 * Three states in one place because they are one decision: the shopper wants this
 * variant. If it is in stock they add it, if it is not they ask to be told when it
 * returns, and either way they may want it saved for later.
 */
export function ProductActions({
  productId,
  variantId,
  inStock,
  priceMinor,
  dictionary,
  locale,
}: {
  productId: string;
  variantId: string | null;
  inStock: boolean;
  priceMinor: string;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const addItem = useCart((state) => state.addItem);
  const busy = useCart((state) => state.busy);

  const [wishlisted, setWishlisted] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [notified, setNotified] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function add() {
    if (!variantId) return;
    const ok = await addItem(variantId, 1);
    if (ok) {
      track({ name: 'add_to_cart', productId, variantId, valueMinor: Number(priceMinor) });
    }
  }

  async function saveToWishlist() {
    setPending(true);
    setMessage(null);
    try {
      await clientApi('/wishlist', {
        method: 'POST',
        body: { productId, variantId: variantId ?? undefined },
      });
      setWishlisted(true);
      track({ name: 'wishlist_add', productId, variantId: variantId ?? undefined });
    } catch (error) {
      // Not signed in is the common case, and it deserves an instruction rather than
      // a silent no-op or a login redirect that loses the product page.
      setMessage(errorMessage(error, dictionary.account.signInHint));
    } finally {
      setPending(false);
    }
  }

  async function registerNotify() {
    if (!isValidDzPhone(phone)) {
      setMessage(dictionary.notify.phone);
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      await clientApi('/stock-notifications', {
        method: 'POST',
        body: { productId, variantId: variantId ?? undefined, phone },
      });
      setNotified(true);
    } catch (error) {
      setMessage(errorMessage(error, dictionary.common.error));
    } finally {
      setPending(false);
    }
  }

  async function share() {
    const url = window.location.href;
    if (typeof navigator.share === 'function') {
      await navigator.share({ url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setMessage(url);
  }

  return (
    <div className="flex flex-col gap-2">
      {inStock ? (
        <Button
          size="lg"
          editorial
          loading={busy}
          disabled={!variantId}
          onClick={() => void add()}
        >
          {dictionary.product.addToCart}
        </Button>
      ) : notified ? (
        <p className="flex items-center justify-center gap-2 border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          <Check className="h-4 w-4" />
          {dictionary.notify.done}
        </p>
      ) : notifyOpen ? (
        <div className="flex flex-col gap-2 border border-line p-3">
          <p className="text-sm text-muted">{dictionary.notify.hint}</p>
          <div className="flex gap-2">
            <input
              type="tel"
              inputMode="tel"
              dir="ltr"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="0550 11 22 33"
              aria-label={dictionary.notify.phone}
              className="min-w-0 flex-1 rounded-xs border border-line bg-base px-3 py-2 text-sm outline-none focus:border-brass"
            />
            <Button size="md" loading={pending} onClick={() => void registerNotify()}>
              {dictionary.notify.submit}
            </Button>
          </div>
        </div>
      ) : (
        <Button size="lg" editorial variant="outline" onClick={() => setNotifyOpen(true)}>
          {dictionary.product.notifyMe}
        </Button>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="md"
          className="flex-1"
          loading={pending && !notifyOpen}
          onClick={() => void saveToWishlist()}
        >
          <Heart className={wishlisted ? 'h-4 w-4 fill-brass text-brass' : 'h-4 w-4'} />
          {dictionary.nav.wishlist}
        </Button>
        <Button variant="outline" size="icon" aria-label="Partager" onClick={() => void share()}>
          <Share2 className="h-4 w-4" />
        </Button>
      </div>

      {message ? (
        <p role="status" className="break-all text-xs text-muted">
          {message}
        </p>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {busy ? dictionary.common.loading : ''}
      </p>

      <noscript>
        <p className="text-xs text-muted">
          {locale === 'ar'
            ? 'يلزم تفعيل الجافاسكريبت لإضافة المنتجات إلى السلة.'
            : 'JavaScript is required to add items to the cart.'}
        </p>
      </noscript>

      {pending ? <Loader2 className="sr-only h-0 w-0 animate-spin" aria-hidden /> : null}
    </div>
  );
}
