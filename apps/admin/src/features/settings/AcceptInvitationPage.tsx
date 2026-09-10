import { Alert, Button, Card, CardBody, Field, Input, notify } from '@jecks/ui';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiRequestError } from '@/lib/api';
import { message } from '@/lib/errors';
import * as settingsApi from './api';

/**
 * Accepting a staff invitation — PRD F-AD-92.
 *
 * Reachable without a session, which is the whole point: the invitee has no account
 * until they land here and choose a password. The token is single-use and expires after
 * 72 hours, so a forwarded link is not a standing door.
 */
export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= 10 && !mismatch;

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const result = await settingsApi.acceptInvitation({ token, password });
      setDone(result.email);
      notify.success('Compte activé');
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'activation a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <div className="w-full max-w-md">
        <p className="mb-8 text-center font-display text-3xl tracking-[0.2em] text-brass">
          JECK&apos;S
        </p>

        <Card>
          <CardBody className="flex flex-col gap-5">
            {!token ? (
              <Alert tone="danger" title="Lien incomplet">
                Ce lien ne contient pas de jeton d’invitation. Demandez-en un nouveau au
                propriétaire de la boutique.
              </Alert>
            ) : done ? (
              <>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
                  <div>
                    <p className="font-medium text-ink">Compte activé</p>
                    <p className="text-sm text-muted">
                      Connectez-vous avec {done} et le mot de passe que vous venez de choisir.
                    </p>
                  </div>
                </div>
                <Button onClick={() => navigate('/login')}>Aller à la connexion</Button>
              </>
            ) : (
              <>
                <div>
                  <h1 className="text-lg font-semibold">Choisissez votre mot de passe</h1>
                  <p className="mt-1 text-sm text-muted">
                    Au moins 10 caractères, avec une majuscule, une minuscule et un chiffre.
                  </p>
                </div>

                <Field label="Mot de passe" required error={errors.password}>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>

                <Field
                  label="Confirmation"
                  required
                  error={mismatch ? 'Les deux saisies diffèrent' : undefined}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </Field>

                <Button loading={busy} disabled={!valid} onClick={() => void submit()}>
                  Activer mon compte
                </Button>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
