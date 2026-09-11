import { Badge, Button, Card, CardBody, notify } from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { PlugZap } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/features/auth/session';
import { message } from '@/lib/errors';
import * as settingsApi from './api';

/**
 * Payment providers, under the Paiements form — PRD F-ST-45.
 *
 * The form above stores the key. This says whether it works. The distinction matters:
 * a key pasted with a trailing space is stored successfully, shows as configured, and
 * fails at checkout with a customer waiting.
 *
 * The test is read-only. Creating a one-dinar payment to prove the key works would
 * leave a row in the shop's dashboard every time somebody pressed the button.
 */
export function PaymentProvidersPanel() {
  const canWrite = useSession((state) => state.can)('settings.write');
  const [testing, setTesting] = useState<string | null>(null);

  const providers = useQuery({
    queryKey: ['admin', 'payment-providers'],
    queryFn: settingsApi.listPaymentProviders,
    staleTime: 30_000,
  });

  async function test(key: string) {
    setTesting(key);
    try {
      const result = await settingsApi.testPaymentProvider(key);
      if (result.ok) notify.success(result.message);
      else notify.error(result.message);
    } catch (error) {
      notify.error(message(error, 'Le test a échoué'));
    } finally {
      setTesting(null);
    }
  }

  if (providers.isLoading || (providers.data ?? []).length === 0) return null;

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-ink">État des moyens de paiement</p>
          <p className="text-xs text-muted">
            Enregistrez d’abord la clé, puis vérifiez qu’elle est acceptée.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {(providers.data ?? []).map((provider) => (
            <div
              key={provider.key}
              className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line px-3 py-2.5"
            >
              <p className="flex items-center gap-2 text-sm text-ink">
                {provider.label}
                {provider.configured ? (
                  <Badge tone="success">Actif</Badge>
                ) : (
                  <Badge tone="neutral">Inactif</Badge>
                )}
                {provider.redirects ? (
                  <span className="text-xs text-muted">redirige le client</span>
                ) : null}
              </p>

              <Button
                size="sm"
                variant="ghost"
                disabled={!canWrite}
                loading={testing === provider.key}
                onClick={() => void test(provider.key)}
              >
                <PlugZap className="h-4 w-4" />
                Tester
              </Button>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
