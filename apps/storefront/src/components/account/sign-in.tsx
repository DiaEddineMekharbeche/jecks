'use client';

import { isValidDzPhone } from '@jecks/shared';
import { Button } from '@jecks/ui';
import { useState } from 'react';
import { useSession } from '@/lib/session-store';
import type { Dictionary } from '@/lib/dictionary';

/**
 * Shopper sign-in — PRD F-ST-51.
 *
 * Phone plus a six-digit code. No password: an Algerian shopper buying a cap once a
 * season will not remember one, and a password they do remember is one they reuse.
 */
export function SignIn({ dictionary }: { dictionary: Dictionary }) {
  const requestCode = useSession((state) => state.requestCode);
  const verifyCode = useSession((state) => state.verifyCode);
  const reset = useSession((state) => state.reset);
  const pendingPhone = useSession((state) => state.pendingPhone);
  const devCode = useSession((state) => state.devCode);
  const busy = useSession((state) => state.busy);
  const error = useSession((state) => state.error);

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  const phoneValid = isValidDzPhone(phone);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-5">
      <div>
        <h1 className="text-section">{dictionary.account.signIn}</h1>
        <p className="mt-2 text-sm text-muted">{dictionary.account.signInHint}</p>
      </div>

      {pendingPhone ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await verifyCode(code);
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted">
              {dictionary.account.code}
            </span>
            <input
              autoFocus
              inputMode="numeric"
              dir="ltr"
              maxLength={6}
              pattern="\d{6}"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              className="input-line text-center text-2xl tracking-[0.4em]"
            />
          </label>

          {devCode ? (
            <p className="rounded-xs border border-brass/40 bg-brass/10 px-3 py-2 text-xs text-brass">
              Code de développement : <span className="font-mono">{devCode}</span>
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" loading={busy} disabled={code.length !== 6}>
            {dictionary.account.verify}
          </Button>

          <button
            type="button"
            className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
            onClick={() => {
              reset();
              setCode('');
            }}
          >
            {dictionary.account.resend}
          </button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await requestCode(phone);
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted">
              {dictionary.account.phone}
            </span>
            <input
              autoFocus
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

          <Button type="submit" loading={busy} disabled={!phoneValid}>
            {dictionary.account.sendCode}
          </Button>
        </form>
      )}
    </div>
  );
}
