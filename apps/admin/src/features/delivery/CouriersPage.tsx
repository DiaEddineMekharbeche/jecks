import { COURIER_PROVIDERS, SECRET_MASK, type CourierDto } from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  SwitchField,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, KeyRound, Plus, Plug, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { formatDa, message } from '@/lib/errors';
import * as delivery from './api';
import { COURIER_PROVIDER_LABELS } from './labels';

/**
 * Couriers — PRD F-AD-61 and Settings › Couriers.
 *
 * Each card answers the only two questions that matter before a parcel is handed over:
 * can this integration actually be used, and how much of our cash is it sitting on.
 */
export function CouriersPage() {
  const [editing, setEditing] = useState<CourierDto | 'new' | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<CourierDto | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const couriers = useQuery({ queryKey: ['admin', 'couriers'], queryFn: delivery.listCouriers });

  const providers = useQuery({
    queryKey: ['admin', 'courier-providers'],
    queryFn: delivery.courierProviders,
    staleTime: Infinity,
  });

  async function test(courier: CourierDto) {
    setTesting(courier.id);
    try {
      const result = await delivery.testCourier(courier.id);
      if (result.ok) notify.success(result.message);
      else notify.error(result.message);
    } catch (error) {
      notify.error(message(error, 'Le test a échoué'));
    } finally {
      setTesting(null);
    }
  }

  async function remove(courier: CourierDto) {
    const warning =
      courier.shipmentCount > 0
        ? `« ${courier.name} » a ${courier.shipmentCount} expédition(s) : il sera désactivé, pas supprimé. Continuer ?`
        : `Supprimer « ${courier.name} » ?`;
    if (!window.confirm(warning)) return;

    try {
      await delivery.deleteCourier(courier.id);
      notify.success('Transporteur retiré');
      void couriers.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Transporteurs"
        description="Les intégrations, ce qu’il leur manque, et l’argent qu’ils détiennent."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Ajouter un transporteur
          </Button>
        }
      />

      {couriers.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-40" label="Chargement des transporteurs" />
          <Skeleton className="h-40" />
        </div>
      ) : (couriers.data ?? []).length === 0 ? (
        <EmptyState
          title="Aucun transporteur"
          description="Commencez par la remise en main propre : elle ne demande aucune configuration."
          action={
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Ajouter un transporteur
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {couriers.data!.map((courier) => (
            <Card key={courier.id} className={cn(!courier.active && 'opacity-60')}>
              <CardBody className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{courier.name}</p>
                    <p className="truncate text-xs text-muted">
                      {COURIER_PROVIDER_LABELS[courier.provider] ?? courier.provider}
                    </p>
                  </div>
                  {courier.ready ? (
                    <Badge tone="success">
                      <CheckCircle2 className="h-3 w-3" />
                      Prêt
                    </Badge>
                  ) : (
                    <Badge tone="warning">
                      <AlertTriangle className="h-3 w-3" />
                      À configurer
                    </Badge>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wider text-muted">Expéditions</dt>
                    <dd className="tabular-nums">{courier.shipmentCount}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wider text-muted">Cash détenu</dt>
                    <dd className="tabular-nums">{formatDa(courier.openCodMinor)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wider text-muted">Commission</dt>
                    <dd className="tabular-nums">{courier.codFeePercent} %</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wider text-muted">Règlement</dt>
                    <dd className="tabular-nums">{courier.settlementDays} j</dd>
                  </div>
                </dl>

                <p className="text-xs text-muted">
                  {courier.supportsWebhook
                    ? 'Envoie ses mises à jour automatiquement.'
                    : 'Interrogé toutes les 20 minutes.'}
                </p>

                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <Button variant="outline" size="sm" onClick={() => setEditing(courier)}>
                    Modifier
                  </Button>
                  {(providers.data?.[courier.provider]?.length ?? 0) > 0 ? (
                    <Button variant="outline" size="sm" onClick={() => setCredentialsFor(courier)}>
                      <KeyRound className="h-4 w-4" />
                      Identifiants
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={testing === courier.id}
                    onClick={() => void test(courier)}
                  >
                    <Plug className="h-4 w-4" />
                    Tester
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Retirer ${courier.name}`}
                    className="ms-auto"
                    onClick={() => void remove(courier)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {editing ? (
        <CourierDialog
          courier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void couriers.refetch();
          }}
        />
      ) : null}

      {credentialsFor ? (
        <CredentialsDialog
          courier={credentialsFor}
          fields={providers.data?.[credentialsFor.provider] ?? []}
          onClose={() => setCredentialsFor(null)}
          onSaved={() => {
            setCredentialsFor(null);
            void couriers.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function CourierDialog({
  courier,
  onClose,
  onSaved,
}: {
  courier: CourierDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(courier?.name ?? '');
  const [slug, setSlug] = useState(courier?.slug ?? '');
  const [provider, setProvider] = useState<string>(courier?.provider ?? 'manual');
  const [phone, setPhone] = useState(courier?.phone ?? '');
  const [email, setEmail] = useState(courier?.email ?? '');
  const [codFeePercent, setCodFeePercent] = useState(String(courier?.codFeePercent ?? 0));
  const [settlementDays, setSettlementDays] = useState(String(courier?.settlementDays ?? 7));
  const [active, setActive] = useState(courier?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        name: name.trim(),
        slug: slug.trim() || slugify(name),
        provider,
        phone: phone.trim() || null,
        email: email.trim() || null,
        codFeePercent: Number(codFeePercent),
        settlementDays: Number(settlementDays),
        active,
      };

      if (courier) await delivery.updateCourier(courier.id, payload);
      else await delivery.createCourier(payload);

      notify.success(courier ? 'Transporteur mis à jour' : 'Transporteur ajouté');
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{courier ? courier.name : 'Nouveau transporteur'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom" required error={errors.name}>
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!courier) setSlug(slugify(event.target.value));
              }}
              placeholder="Yalidine"
            />
          </Field>

          <Field label="Identifiant" hint="Utilisé dans les URL de webhook." error={errors.slug}>
            <Input
              value={slug}
              onChange={(event) => setSlug(slugify(event.target.value))}
              className="font-mono"
            />
          </Field>

          <Field
            label="Intégration"
            hint="« Remise en main propre » convient tant que les suivis sont saisis à la main."
          >
            <Select
              value={provider}
              onValueChange={setProvider}
              options={COURIER_PROVIDERS.map((key) => ({
                value: key,
                label: COURIER_PROVIDER_LABELS[key] ?? key,
              }))}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Téléphone">
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </Field>
            <Field label="E-mail" error={errors.email}>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Commission COD"
              hint="Pourcentage de l’encaissement qu’ils gardent, en plus des frais de livraison."
            >
              <Input
                type="number"
                min={0}
                max={100}
                step="0.25"
                value={codFeePercent}
                onChange={(event) => setCodFeePercent(event.target.value)}
              />
            </Field>
            <Field label="Délai de règlement" hint="En jours.">
              <Input
                type="number"
                min={0}
                max={90}
                value={settlementDays}
                onChange={(event) => setSettlementDays(event.target.value)}
              />
            </Field>
          </div>

          <SwitchField label="Actif" checked={active} onCheckedChange={setActive} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Credentials go in and never come back.
 *
 * A key that is already stored shows as a mask, and sending the mask back means "leave
 * it alone". That is what lets an owner change one field of a form without having to
 * retype an API token they no longer have.
 */
function CredentialsDialog({
  courier,
  fields,
  onClose,
  onSaved,
}: {
  courier: CourierDto;
  fields: Array<{ key: string; label: string; secret: boolean; hint?: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((field) => [field.key, courier.configuredKeys.includes(field.key) ? SECRET_MASK : '']),
    ),
  );
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await delivery.saveCourierCredentials(courier.id, values);
      notify.success('Identifiants enregistrés');
      onSaved();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Identifiants — {courier.name}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Alert tone="info" title="Chiffrés au repos">
            Les valeurs déjà enregistrées apparaissent masquées. Laissez le masque pour ne pas y
            toucher, videz un champ pour l’effacer.
          </Alert>

          {fields.map((field) => (
            <Field key={field.key} label={field.label} hint={field.hint}>
              <Input
                type={field.secret ? 'password' : 'text'}
                value={values[field.key] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
                onFocus={(event) => {
                  // Clear the mask on focus, so typing replaces rather than appends.
                  if (event.target.value === SECRET_MASK) {
                    setValues((current) => ({ ...current, [field.key]: '' }));
                  }
                }}
                className="font-mono"
                autoComplete="off"
              />
            </Field>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}
