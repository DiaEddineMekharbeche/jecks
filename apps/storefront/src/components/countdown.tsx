'use client';

import { useEffect, useState } from 'react';

/** Drop and flash-sale countdown — PRD F-ST-12. Renders nothing once the sale ends. */
export function Countdown({ endsAt }: { endsAt: string }) {
  const target = new Date(endsAt).getTime();
  const [remaining, setRemaining] = useState(() => Math.max(target - Date.now(), 0));

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setRemaining(Math.max(target - Date.now(), 0)), 1000);
    return () => clearInterval(timer);
  }, [target, remaining]);

  if (remaining <= 0) return null;

  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);

  return (
    // The live region is polite and coarse: announcing every second would be hostile.
    <div className="flex items-center gap-2" role="timer" aria-live="off">
      {[
        { value: days, label: 'j' },
        { value: hours, label: 'h' },
        { value: minutes, label: 'm' },
        { value: seconds, label: 's' },
      ].map((part) => (
        <div
          key={part.label}
          className="flex min-w-16 flex-col items-center rounded-sm border border-line bg-base px-3 py-2"
        >
          <span className="font-display text-2xl tabular-nums text-ink">
            {String(part.value).padStart(2, '0')}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-muted">{part.label}</span>
        </div>
      ))}
    </div>
  );
}
