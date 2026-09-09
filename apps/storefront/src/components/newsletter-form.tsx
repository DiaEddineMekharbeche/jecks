'use client';

import { Button, Input } from '@jecks/ui';
import { useState, type FormEvent } from 'react';
import type { Dictionary } from '@/lib/dictionary';

/**
 * Newsletter capture (PRD F-ST-04). The POST endpoint lands with the marketing module
 * in M6; until then the form validates and gives honest feedback rather than pretending
 * to have subscribed anyone.
 */
export function NewsletterForm({ dictionary }: { dictionary: Dictionary }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'pending' | 'done'>('idle');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setState('pending');
    // TODO(M6): POST /marketing/newsletter once the subscribers module ships.
    setTimeout(() => setState('done'), 300);
  }

  if (state === 'done') {
    return (
      <p className="mt-4 text-sm text-brass" role="status">
        {dictionary.footer.subscribe} ✓
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex max-w-sm gap-2">
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
    </form>
  );
}
