'use client';

import { isValidDzPhone, type Locale, type TrackedOrder } from '@jecks/shared';
import { Button } from '@jecks/ui';
import { useState } from 'react';
import { OrderDetail } from './account/panels';
import { clientApi, errorMessage } from '@/lib/client-api';
import type { Dictionary } from '@/lib/dictionary';

/**
 * Public order tracking — PRD F-ST-52.
 *
 * Number plus phone. Most COD shoppers never sign in, so this page is how the majority
 * of them find out where their parcel is, and it is the single most-requested thing an
 * order agent otherwise answers by telephone.
 */
export function TrackForm({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const [number, setNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = number.trim().length >= 4 && isValidDzPhone(phone);

  if (order) {
    return (
      <div className="flex flex-col gap-6">
        <OrderDetail order={order} locale={locale} dictionary={dictionary} />
        <button
          type="button"
          onClick={() => setOrder(null)}
          className="self-start text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {dictionary.common.back}
        </button>
      </div>
    );
  }

  return (
    <form
      className="mx-auto flex w-full max-w-sm flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          setOrder(
            await clientApi<TrackedOrder>('/orders/track', {
              method: 'POST',
              body: { number: number.trim().toUpperCase(), phone },
            }),
          );
        } catch (trackError) {
          setError(errorMessage(trackError, dictionary.track.notFound));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h1 className="text-section">{dictionary.track.title}</h1>
        <p className="mt-2 text-sm text-muted">{dictionary.track.hint}</p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted">
          {dictionary.track.number}
        </span>
        <input
          required
          dir="ltr"
          value={number}
          onChange={(event) => setNumber(event.target.value.toUpperCase())}
          placeholder="JK-260910-0042"
          className="input-line font-mono"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted">
          {dictionary.track.phone}
        </span>
        <input
          required
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="0550 11 22 33"
          className="input-line"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={busy} disabled={!ready}>
        {dictionary.track.submit}
      </Button>
    </form>
  );
}
