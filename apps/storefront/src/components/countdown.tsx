'use client';

import { useEffect, useState } from 'react';

/**
 * Drop and flash-sale countdown — PRD F-ST-12. Renders nothing once the sale ends.
 *
 * Nothing time-dependent is computed while rendering. The server renders this page at
 * one moment and the browser hydrates it at another, so a `Date.now()` in the render
 * path means the two produce different text and React throws a hydration error — which
 * is what used to happen here, reliably, about once a second.
 *
 * So the first paint is a placeholder with the final layout, and the real figures arrive
 * on mount. The boxes do not move when they do.
 */
export function Countdown({ endsAt }: { endsAt: string }) {
  const target = new Date(endsAt).getTime();
  // Null until mounted: the server has no opinion about how long is left.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(target)) return;

    const tick = () => setRemaining(Math.max(target - Date.now(), 0));
    tick();

    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [target]);

  // Mounted, and the sale is over.
  if (remaining !== null && remaining <= 0) return null;

  const parts = splitDuration(remaining);

  return (
    // The live region is polite and coarse: announcing every second would be hostile.
    <div className="flex items-center gap-2" role="timer" aria-live="off">
      {parts.map((part) => (
        <div
          key={part.label}
          className="flex min-w-16 flex-col items-center rounded-sm border border-line bg-base px-3 py-2"
        >
          <span className="font-display text-2xl tabular-nums text-ink">{part.value}</span>
          <span className="text-[10px] uppercase tracking-widest text-muted">{part.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface CountdownPart {
  value: string;
  label: string;
}

/**
 * Milliseconds as days, hours, minutes and seconds, each already padded.
 *
 * `null` means "not known yet" and gives the placeholder, so the markup the server sends
 * and the markup the browser first renders are the same string.
 */
export function splitDuration(remaining: number | null): CountdownPart[] {
  const labels = ['j', 'h', 'm', 's'];

  if (remaining === null || !Number.isFinite(remaining) || remaining < 0) {
    return labels.map((label) => ({ value: '--', label }));
  }

  const values = [
    Math.floor(remaining / 86_400_000),
    Math.floor((remaining % 86_400_000) / 3_600_000),
    Math.floor((remaining % 3_600_000) / 60_000),
    Math.floor((remaining % 60_000) / 1000),
  ];

  return values.map((value, index) => ({
    value: String(value).padStart(2, '0'),
    label: labels[index]!,
  }));
}
