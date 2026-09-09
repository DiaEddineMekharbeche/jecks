'use client';

import { buttonVariants } from '@jecks/ui';
import { useEffect } from 'react';

/**
 * Catches render errors in the locale tree — most often the API being unreachable.
 * The message stays generic; the detail goes to the console and, in production, to the
 * error tracker configured in PRD Section 10.9.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="shell flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="font-display text-hero">Oups</p>
      <p className="max-w-prose text-muted">
        La boutique est momentanément indisponible. Réessayez dans un instant.
      </p>
      <button type="button" onClick={reset} className={buttonVariants({ variant: 'outline' })}>
        Réessayer
      </button>
    </div>
  );
}
