'use client';

import type { Locale, TrackedOrder } from '@jecks/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { OrderDetail } from './panels';
import { clientApi, errorMessage } from '@/lib/client-api';
import type { Dictionary } from '@/lib/dictionary';

/**
 * Loads one of the shopper's own orders.
 *
 * Client-side because the account area is behind an httpOnly session cookie that a
 * cached server render must never be allowed to bake into a page.
 */
export function OrderDetailLoader({
  number,
  locale,
  dictionary,
}: {
  number: string;
  locale: Locale;
  dictionary: Dictionary;
}) {
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clientApi<TrackedOrder>(`/account/orders/${encodeURIComponent(number)}`)
      .then(setOrder)
      .catch((loadError) => setError(errorMessage(loadError, dictionary.track.notFound)));
  }, [number, dictionary.track.notFound]);

  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-danger">{error}</p>
        <Link
          href={`/${locale}/account/orders`}
          className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {dictionary.common.back}
        </Link>
      </div>
    );
  }

  if (!order) return <p className="text-sm text-muted">{dictionary.common.loading}</p>;

  return <OrderDetail order={order} locale={locale} dictionary={dictionary} />;
}
