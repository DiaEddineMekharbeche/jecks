import { Alert, Button, Card, Field, Input } from '@jecks/ui';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiRequestError } from '@/lib/api';
import { useSession } from './session';

export function LoginPage() {
  const signIn = useSession((state) => state.signIn);
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password, needsTotp ? totp : undefined);
      // Send the user back where they were headed before the guard intercepted them.
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.code === 'TOTP_REQUIRED') {
        setNeedsTotp(true);
        setError(null);
      } else {
        setError(cause instanceof Error ? cause.message : 'Sign-in failed');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-base p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-display text-4xl tracking-[0.2em] text-brass">JECK&apos;S</p>
          <p className="mt-1 text-sm text-muted">Back-office</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6" noValidate>
            {error ? <Alert tone="danger">{error}</Alert> : null}

            <Field label="Adresse e-mail" required>
              <Input
                type="email"
                name="email"
                autoComplete="username"
                autoFocus
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Field label="Mot de passe" required>
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>

            {needsTotp ? (
              <Field
                label="Code à 6 chiffres"
                hint="Ouvrez votre application d’authentification"
                required
              >
                <Input
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  value={totp}
                  onChange={(event) => setTotp(event.target.value.replace(/\D/g, ''))}
                />
              </Field>
            ) : null}

            <Button type="submit" loading={submitting} className="mt-2">
              Se connecter
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-muted">
          Accès réservé au personnel. Toute action est journalisée.
        </p>
      </div>
    </main>
  );
}
