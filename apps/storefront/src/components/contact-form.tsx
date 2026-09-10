'use client';

import { Button } from '@jecks/ui';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { clientApi, errorMessage } from '@/lib/client-api';
import type { Dictionary } from '@/lib/dictionary';

/** Contact form — PRD F-ST-50. Lands in the admin as a `ContactMessage`. */
export function ContactForm({ dictionary }: { dictionary: Dictionary }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: '', body: '' });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <p className="mx-auto flex max-w-md items-center gap-2 border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
        <Check className="h-4 w-4 shrink-0" />
        {dictionary.contact.sent}
      </p>
    );
  }

  return (
    <form
      className="mx-auto flex w-full max-w-md flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await clientApi('/contact', {
            method: 'POST',
            body: {
              name: form.name,
              email: form.email || undefined,
              phone: form.phone || undefined,
              subject: form.subject || undefined,
              body: form.body,
            },
          });
          setSent(true);
        } catch (sendError) {
          setError(errorMessage(sendError, dictionary.common.error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="text-section">{dictionary.contact.title}</h1>

      <Field label={dictionary.contact.name}>
        <input
          required
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          className="input-line"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={dictionary.contact.email}>
          <input
            type="email"
            dir="ltr"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            className="input-line"
          />
        </Field>
        <Field label={dictionary.contact.phone}>
          <input
            type="tel"
            dir="ltr"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            className="input-line"
          />
        </Field>
      </div>

      <Field label={dictionary.contact.subject}>
        <input
          value={form.subject}
          onChange={(event) => setForm({ ...form, subject: event.target.value })}
          className="input-line"
        />
      </Field>

      <Field label={dictionary.contact.body}>
        <textarea
          required
          rows={5}
          minLength={10}
          value={form.body}
          onChange={(event) => setForm({ ...form, body: event.target.value })}
          className="input-line"
        />
      </Field>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={busy} disabled={form.body.trim().length < 10 || !form.name.trim()}>
        {dictionary.contact.submit}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}
