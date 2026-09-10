import type { LocationDto, LocationInput } from '@jecks/shared';
import {
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
  Skeleton,
  SwitchField,
  Textarea,
  notify,
} from '@jecks/ui';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { message } from '@/lib/errors';
import * as inventory from './api';
import { useInventoryInvalidate, useLocations } from './queries';

/**
 * Stock locations — PRD F-AD-50.
 *
 * A shop runs on two or three of these, so they are cards rather than a table: the
 * default badge and the unit count are the only things an operator ever scans for.
 */

const EMPTY: LocationInput = {
  name: '',
  code: '',
  address: '',
  isDefault: false,
  active: true,
};

export function LocationsPage() {
  const locations = useLocations();
  const invalidate = useInventoryInvalidate();

  const [editing, setEditing] = useState<LocationDto | 'new' | null>(null);
  const [confirming, setConfirming] = useState<LocationDto | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirming) return;
    setBusy(true);
    try {
      await inventory.deleteLocation(confirming.id);
      notify.success(`« ${confirming.name} » supprimé`);
      setConfirming(null);
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Emplacements"
        description="Entrepôts et boutiques où le stock est physiquement détenu."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Nouvel emplacement
          </Button>
        }
      />

      {locations.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" label="Chargement" />
          ))}
        </div>
      ) : locations.error ? (
        <EmptyState
          title="Liste indisponible"
          description={(locations.error as Error).message}
          action={
            <Button variant="outline" size="sm" onClick={() => void locations.refetch()}>
              Réessayer
            </Button>
          }
        />
      ) : (locations.data ?? []).length === 0 ? (
        <EmptyState
          icon={<MapPin className="h-8 w-8" />}
          title="Aucun emplacement"
          description="Créez au moins un emplacement avant de recevoir du stock."
          action={
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Nouvel emplacement
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(locations.data ?? []).map((location) => (
            <Card key={location.id}>
              <CardBody className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{location.name}</p>
                    <p className="truncate text-xs text-muted">
                      {location.code}
                      {location.wilayaName ? ` · ${location.wilayaName}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {location.isDefault ? <Badge tone="brass">Par défaut</Badge> : null}
                    {location.active ? null : <Badge tone="neutral">Inactif</Badge>}
                  </div>
                </div>

                {location.address ? (
                  <p className="text-xs text-muted">{location.address}</p>
                ) : null}

                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">{location.onHand}</p>
                    <p className="text-xs text-muted">
                      unités sur {location.variantCount} référence
                      {location.variantCount > 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(location)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(location)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <LocationDialog
        location={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          invalidate();
        }}
      />

      <Dialog
        open={Boolean(confirming)}
        onOpenChange={(open) => (open ? undefined : setConfirming(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer cet emplacement ?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted">
              « {confirming?.name} » sera supprimé. Un emplacement qui détient du stock ou possède
              un historique ne peut pas être supprimé : désactivez-le à la place.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Annuler
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void handleDelete()}>
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LocationDialog({
  location,
  onClose,
  onSaved,
}: {
  location: LocationDto | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = location === 'new';
  const [form, setForm] = useState<LocationInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  const key = location === null ? null : isNew ? 'new' : location.id;
  if (key !== seeded) {
    setSeeded(key);
    setErrors({});
    setForm(
      location && location !== 'new'
        ? {
            name: location.name,
            code: location.code,
            address: location.address ?? '',
            wilayaCode: location.wilayaCode ?? undefined,
            isDefault: location.isDefault,
            active: location.active,
          }
        : EMPTY,
    );
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const payload = { ...form, address: form.address || undefined };
      if (location === 'new') await inventory.createLocation(payload);
      else if (location) await inventory.updateLocation(location.id, payload);
      notify.success(isNew ? 'Emplacement créé' : 'Emplacement mis à jour');
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(location)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? 'Nouvel emplacement' : "Modifier l'emplacement"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom" required error={errors.name}>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Entrepôt Alger"
            />
          </Field>
          <Field
            label="Code"
            required
            hint="Majuscules et chiffres, utilisé dans les exports"
            error={errors.code}
          >
            <Input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              placeholder="ALG-01"
            />
          </Field>
          <Field label="Wilaya" hint="Code de 1 à 58" error={errors.wilayaCode}>
            <Input
              type="number"
              min={1}
              max={58}
              value={form.wilayaCode ?? ''}
              onChange={(event) =>
                setForm({
                  ...form,
                  wilayaCode: event.target.value ? Number(event.target.value) : undefined,
                })
              }
            />
          </Field>
          <Field label="Adresse" error={errors.address}>
            <Textarea
              rows={2}
              value={form.address ?? ''}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
            />
          </Field>
          <SwitchField
            label="Emplacement par défaut"
            description="Reçoit le stock quand aucun emplacement n’est précisé."
            checked={form.isDefault}
            onCheckedChange={(checked) => setForm({ ...form, isDefault: checked })}
          />
          <SwitchField
            label="Actif"
            checked={form.active}
            onCheckedChange={(checked) => setForm({ ...form, active: checked })}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!form.name.trim() || form.code.trim().length < 2}
            loading={busy}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
