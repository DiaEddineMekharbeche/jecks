'use client';

import { format, money, t, type Locale } from '@jecks/shared';
import { cn } from '@jecks/ui';
import { AlertCircle, Minus, Plus, ShoppingBag, Tag, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useCart } from '@/lib/cart-store';
import { fill, type Dictionary } from '@/lib/dictionary';

/**
 * The cart drawer — PRD F-ST-41.
 *
 * Slides over the page rather than navigating, because the shopper's next action is
 * usually "keep browsing" and a full page change loses their place in a grid they
 * scrolled to.
 *
 * Every number here comes from the server. The free-shipping bar, the discount line and
 * the total are read, not computed, so the drawer can never promise a total the
 * checkout will refuse.
 */
export function CartDrawer({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const cart = useCart((state) => state.cart);
  const open = useCart((state) => state.open);
  const busy = useCart((state) => state.busy);
  const error = useCart((state) => state.error);
  const pendingLines = useCart((state) => state.pendingLines);
  const setOpen = useCart((state) => state.setOpen);
  const setQuantity = useCart((state) => state.setQuantity);
  const removeItem = useCart((state) => state.removeItem);
  const applyPromo = useCart((state) => state.applyPromo);
  const removePromo = useCart((state) => state.removePromo);
  const clearError = useCart((state) => state.clearError);

  const [code, setCode] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and focus moves into the panel: a drawer that traps neither is a
  // drawer a keyboard user cannot leave.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) clearError();
  }, [open, clearError]);

  if (!open) return null;

  const items = cart?.items ?? [];
  const currency = (cart?.currency ?? 'DZD') as 'DZD';
  const amount = (value: string | null | undefined) =>
    format(money(BigInt(value ?? '0'), currency), { locale: `${locale}-DZ` });

  const remaining = cart?.freeShippingRemainingMinor
    ? BigInt(cart.freeShippingRemainingMinor)
    : null;
  const threshold = cart?.freeShippingThresholdMinor
    ? BigInt(cart.freeShippingThresholdMinor)
    : null;
  const progress =
    threshold && threshold > 0n && remaining !== null
      ? Number(((threshold - remaining) * 100n) / threshold)
      : 100;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={dictionary.cart.title}>
      <button
        type="button"
        aria-label={dictionary.nav.close}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      <div
        ref={panelRef}
        className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col bg-surface shadow-card"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 font-display text-xl tracking-[0.15em]">
            <ShoppingBag className="h-5 w-5 text-brass" />
            {dictionary.cart.title}
            {cart && cart.itemCount > 0 ? (
              <span className="text-sm font-normal text-muted">({cart.itemCount})</span>
            ) : null}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label={dictionary.nav.close}
            className="p-1 text-muted transition-colors hover:text-ink"
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {threshold && threshold > 0n ? (
          <div className="border-b border-line px-5 py-3">
            <p className="text-xs text-muted">
              {remaining && remaining > 0n
                ? fill(dictionary.cart.freeShippingProgress, {
                    amount: amount(remaining.toString()),
                  })
                : dictionary.cart.freeShippingReached}
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full bg-brass transition-all duration-500"
                style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        {cart?.notices.length ? (
          <div className="border-b border-line bg-warning/10 px-5 py-3">
            {cart.notices.map((notice) => (
              <p key={notice} className="flex gap-2 text-xs text-warning">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {notice}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <ShoppingBag className="h-10 w-10 text-line" />
              <p className="font-medium">{dictionary.cart.empty}</p>
              <p className="text-sm text-muted">{dictionary.cart.emptyHint}</p>
              <Link
                href={`/${locale}/collections/nouveautes`}
                onClick={() => setOpen(false)}
                className="mt-2 border border-line px-5 py-2 text-sm uppercase tracking-wider transition-colors hover:border-brass hover:text-brass"
              >
                {dictionary.cart.continue}
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {items.map((item) => {
                const pending = pendingLines.includes(item.id);
                return (
                  <li
                    key={item.id}
                    className={cn('flex gap-3', pending && 'pointer-events-none opacity-50')}
                  >
                    <Link
                      href={`/${locale}/products/${item.productSlug}`}
                      onClick={() => setOpen(false)}
                      className="shrink-0"
                    >
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          width={72}
                          height={90}
                          className="h-[90px] w-[72px] rounded-xs object-cover"
                        />
                      ) : (
                        <span className="flex h-[90px] w-[72px] items-center justify-center rounded-xs border border-line" />
                      )}
                    </Link>

                    <div className="flex min-w-0 flex-1 flex-col">
                      <Link
                        href={`/${locale}/products/${item.productSlug}`}
                        onClick={() => setOpen(false)}
                        className="truncate text-sm font-medium hover:text-brass"
                      >
                        {t(item.productName, locale)}
                      </Link>
                      {item.variantName ? (
                        <span className="truncate text-xs text-muted">{item.variantName}</span>
                      ) : null}

                      {item.adjusted === 'price' ? (
                        <span className="mt-0.5 text-[11px] text-warning">
                          {dictionary.cart.priceChanged}
                        </span>
                      ) : null}
                      {item.adjusted === 'quantity' ? (
                        <span className="mt-0.5 text-[11px] text-warning">
                          {dictionary.cart.quantityAdjusted}
                        </span>
                      ) : null}

                      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                        <div className="flex items-center rounded-xs border border-line">
                          <button
                            type="button"
                            aria-label={dictionary.cart.remove}
                            disabled={busy}
                            className="p-1.5 text-muted transition-colors hover:text-ink disabled:opacity-40"
                            onClick={() => void setQuantity(item.id, item.quantity - 1)}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span
                            className="w-8 text-center text-sm tabular-nums"
                            aria-label={dictionary.cart.quantity}
                          >
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label="+"
                            disabled={busy || item.quantity >= item.available}
                            className="p-1.5 text-muted transition-colors hover:text-ink disabled:opacity-40"
                            onClick={() => void setQuantity(item.id, item.quantity + 1)}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="text-end">
                          <span className="text-sm tabular-nums">
                            {amount(item.lineTotalMinor)}
                          </span>
                          {BigInt(item.discountMinor) > 0n ? (
                            <span className="block text-[11px] tabular-nums text-brass">
                              -{amount(item.discountMinor)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      aria-label={dictionary.cart.remove}
                      disabled={busy}
                      className="self-start p-1 text-muted transition-colors hover:text-danger disabled:opacity-40"
                      onClick={() => void removeItem(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 ? (
          <footer className="border-t border-line px-5 py-4">
            {cart?.appliedCode ? (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-xs bg-brass/10 px-3 py-2 text-sm text-brass">
                <span className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  {fill(dictionary.cart.promoApplied, { code: cart.appliedCode })}
                </span>
                <button
                  type="button"
                  className="text-xs underline-offset-2 hover:underline"
                  onClick={() => void removePromo()}
                >
                  {dictionary.cart.promoRemove}
                </button>
              </div>
            ) : (
              <form
                className="mb-3 flex gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!code.trim()) return;
                  const ok = await applyPromo(code.trim().toUpperCase());
                  if (ok) setCode('');
                }}
              >
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder={dictionary.cart.promoPlaceholder}
                  aria-label={dictionary.cart.promoPlaceholder}
                  className="min-w-0 flex-1 rounded-xs border border-line bg-base px-3 py-2 text-sm uppercase tracking-wider outline-none focus:border-brass"
                />
                <button
                  type="submit"
                  disabled={busy || !code.trim()}
                  className="shrink-0 border border-line px-3 py-2 text-xs uppercase tracking-wider transition-colors hover:border-brass hover:text-brass disabled:opacity-40"
                >
                  {dictionary.cart.promoApply}
                </button>
              </form>
            )}

            {error ? (
              <p role="alert" className="mb-3 flex gap-2 text-xs text-danger">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            ) : null}

            <dl className="flex flex-col gap-1.5 text-sm">
              <Row label={dictionary.cart.subtotal} value={amount(cart?.subtotalMinor)} />
              {cart && BigInt(cart.discountMinor) > 0n ? (
                <Row
                  label={dictionary.cart.discount}
                  value={`-${amount(cart.discountMinor)}`}
                  tone="brass"
                />
              ) : null}
              <Row
                label={dictionary.cart.shipping}
                value={
                  cart?.shippingQuoted
                    ? cart.freeShipping || cart.shippingMinor === '0'
                      ? dictionary.delivery.free
                      : amount(cart.shippingMinor)
                    : dictionary.cart.shippingLater
                }
              />
              <div className="mt-1 border-t border-line pt-2">
                <Row label={dictionary.cart.total} value={amount(cart?.totalMinor)} strong />
              </div>
            </dl>

            <Link
              href={`/${locale}/checkout`}
              onClick={() => setOpen(false)}
              className="mt-4 flex h-12 items-center justify-center bg-brass text-sm font-semibold uppercase tracking-[0.15em] text-on-brass transition-colors hover:bg-brass-soft"
            >
              {dictionary.cart.checkout}
            </Link>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'brass';
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={strong ? 'font-medium' : 'text-muted'}>{label}</dt>
      <dd
        className={cn(
          'tabular-nums',
          strong && 'text-lg font-semibold',
          tone === 'brass' && 'text-brass',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
