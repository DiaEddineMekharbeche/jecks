'use client';

import { Button, Input } from '@jecks/ui';
import { useState, type FormEvent } from 'react';
import { clientApi, errorMessage } from '@/lib/client-api';
import type { Dictionary } from '@/lib/dictionary';

/**
 * Newsletter capture — PRD F-ST-04.
 *
 * Single opt-in: an Algerian shopper does not expect a confirmation e-mail, and a
 * double opt-in that half of them never complete produces a list that lies about its
 * size. The server treats a repeat address as success, so no one is told they are
 * already subscribed as if it were an error.
 */
export function NewsletterForm({
  dictionary,
  source = 'footer',
  locale = 'fr',
}: {
  dictionary: Dictionary;
  source?: string;
  locale?: string;
}) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'pending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setState('pending');
    setError(null);
    try {
      await clientApi('/marketing/newsletter', {
        method: 'POST',
        body: { email, locale, source },
      });
      setState('done');
    } catch (submitError) {
      setError(errorMessage(submitError, dictionary.common.error));
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <p className="mt-4 text-sm text-brass" role="status">
        {dictionary.footer.subscribe} ✓
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 flex max-w-sm flex-col gap-2">
      <div className="flex gap-2">
        <label htmlFor="newsletter-email" className="sr-only">
          {dictionary.footer.emailPlaceholder}
        </label>
        <Input
          id="newsletter-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={dictionary.footer.emailPlaceholder}
        />
        <Button type="submit" loading={state === 'pending'}>
          {dictionary.footer.subscribe}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
