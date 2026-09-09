'use client';

import { format, money, t, type Locale } from '@jecks/shared';
import { cn } from '@jecks/ui';
import { Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatEta, type Dictionary } from '@/lib/dictionary';
import type { ShippingQuote, Wilaya } from '@/lib/types';

/**
 * "Select wilaya → see fee and ETA" of PRD F-ST-32.
 *
 * The chosen wilaya is remembered in localStorage so a returning shopper does not pick
 * it again on every product, and so checkout can pre-fill it.
 */
const STORAGE_KEY = 'jk_wilaya';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export function DeliveryEstimator({
  dictionary,
  locale,
  weightGrams,
  subtotal,
}: {
  dictionary: Dictionary;
  locale: Locale;
  weightGrams: number;
  subtotal: string;
}) {
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [code, setCode] = useState<number | null>(null);
  const [deliveryType, setDeliveryType] = useState<'HOME' | 'STOP_DESK'>('HOME');
  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/shipping/wilayas`)
      .then((response) => response.json())
      .then((payload: { data: Wilaya[] }) => {
        if (cancelled) return;
        setWilayas(payload.data ?? []);
        try {
          const stored = Number(localStorage.getItem(STORAGE_KEY));
          if (stored) setCode(stored);
        } catch {
          // Storage blocked; the shopper simply picks their wilaya again.
        }
      })
      .catch(() => setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (code === null) return;
    let cancelled = false;
    setError(false);

    const params = new URLSearchParams({
      wilayaCode: String(code),
      deliveryType,
      weightGrams: String(weightGrams),
      subtotal,
    });

    fetch(`${API}/shipping/quote?${params.toString()}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('no rate'))))
      .then((payload: { data: ShippingQuote }) => {
        if (!cancelled) setQuote(payload.data);
      })
      .catch(() => {
        if (!cancelled) {
          setQuote(null);
          setError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, deliveryType, weightGrams, subtotal]);

  function chooseWilaya(next: number) {
    setCode(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Non-fatal: the estimate still works for this page view.
    }
  }

  return (
    <section className="rounded-sm border border-line p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Truck className="h-4 w-4 text-brass" aria-hidden />
        {dictionary.delivery.title}
      </p>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{dictionary.delivery.chooseWilaya}</span>
          <select
            value={code ?? ''}
            onChange={(event) => chooseWilaya(Number(event.target.value))}
            className="h-10 rounded-sm border border-line bg-surface px-2 text-sm"
          >
            <option value="" disabled>
              —
            </option>
            {wilayas.map((wilaya) => (
              <option key={wilaya.code} value={wilaya.code}>
                {String(wilaya.code).padStart(2, '0')} · {t(wilaya.name, locale)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2" role="group" aria-label={dictionary.delivery.title}>
          {(['HOME', 'STOP_DESK'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={deliveryType === option}
              onClick={() => setDeliveryType(option)}
              className={cn(
                'flex-1 rounded-sm border px-3 py-2 text-xs transition-colors',
                deliveryType === option
                  ? 'border-brass bg-brass/10 text-brass'
                  : 'border-line text-muted hover:text-ink',
              )}
            >
              {option === 'HOME' ? dictionary.delivery.home : dictionary.delivery.stopDesk}
            </button>
          ))}
        </div>

        {code !== null && error ? (
          <p className="text-sm text-danger">{dictionary.delivery.unavailable}</p>
        ) : null}

        {quote ? (
          <dl className="flex items-baseline justify-between text-sm">
            <dt className="text-muted">
              {formatEta(dictionary, quote.etaMinDays, quote.etaMaxDays)}
              {quote.courierName ? ` · ${quote.courierName}` : ''}
            </dt>
            <dd className={cn('font-medium tabular-nums', quote.freeShippingApplied && 'text-success')}>
              {quote.freeShippingApplied
                ? dictionary.delivery.free
                : format(money(BigInt(quote.price)), { locale: `${locale}-DZ` })}
            </dd>
          </dl>
        ) : null}

        <p className="text-xs text-muted">{dictionary.delivery.cod}</p>
      </div>
    </section>
  );
}
