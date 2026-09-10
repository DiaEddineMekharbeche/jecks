import type { DeliveryRunDto } from '@jecks/shared';
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
  Select,
  Skeleton,
  Textarea,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, MapPin, Plus, Truck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDa, message } from '@/lib/errors';
import * as delivery from './api';
import { RUN_STATUS_LABELS, RUN_STATUS_TONES } from './labels';

/**
 * The day's rounds — PRD F-AD-62.
 *
 * A board rather than a table: a dispatcher plans one day at a time and needs to see
 * every driver's load side by side, because balancing them is the whole job.
 */
export function RunsPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [creating, setCreating] = useState(false);

  const runs = useQuery({
    queryKey: ['admin', 'delivery-runs', date],
    queryFn: () => delivery.listRuns({ date }),
  });

  const drivers = useQuery({
    queryKey: ['admin', 'drivers'],
    queryFn: delivery.listDrivers,
    staleTime: 300_000,
  });

  const waiting = useQuery({
    queryKey: ['admin', 'delivery-runs', 'assignable', date],
    queryFn: () => delivery.assignableOrders({ date }),
    staleTime: 30_000,
  });

  function shiftDay(days: number) {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    setDate(next.toISOString().slice(0, 10));
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tournées"
        description="Une journée, un chauffeur par colonne, et ce que chacun doit rapporter."
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" aria-label="Jour précédent" onClick={() => shiftDay(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="w-[150px]"
                aria-label="Jour"
              />
              <Button variant="ghost" size="sm" aria-label="Jour suivant" onClick={() => shiftDay(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Nouvelle tournée
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label="Tournées"
          value={String(runs.data?.length ?? 0)}
          hint={`${runs.data?.filter((run) => run.status === 'IN_PROGRESS').length ?? 0} en cours`}
        />
        <Tile
          label="Arrêts planifiés"
          value={String(runs.data?.reduce((sum, run) => sum + run.stopCount, 0) ?? 0)}
        />
        <Tile
          label="Commandes en attente"
          value={String(waiting.data?.length ?? 0)}
          hint="confirmées, sur aucune tournée"
        />
      </div>

      {runs.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-48" label="Chargement des tournées" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : runs.error ? (
        <EmptyState
          title="Impossible de charger les tournées"
          description={(runs.error as Error).message}
          action={
            <Button size="sm" variant="outline" onClick={() => void runs.refetch()}>
              Réessayer
            </Button>
          }
        />
      ) : (runs.data ?? []).length === 0 ? (
        <EmptyState
          title="Aucune tournée ce jour"
          description={
            (waiting.data?.length ?? 0) > 0
              ? `${waiting.data!.length} commande(s) attendent d’être chargées.`
              : 'Rien à livrer pour l’instant.'
          }
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Planifier une tournée
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {runs.data!.map((run) => (
            <RunCard key={run.id} run={run} onOpen={() => navigate(`/delivery/runs/${run.id}`)} />
          ))}
        </div>
      )}

      <CreateRunDialog
        open={creating}
        date={date}
        drivers={(drivers.data ?? []).filter((driver) => driver.active)}
        onClose={() => setCreating(false)}
        onCreated={(id) => navigate(`/delivery/runs/${id}`)}
      />
    </div>
  );
}

function RunCard({ run, onOpen }: { run: DeliveryRunDto; onOpen: () => void }) {
  const progress = run.stopCount === 0 ? 0 : ((run.deliveredCount + run.failedCount) / run.stopCount) * 100;

  return (
    <Card
      className="cursor-pointer transition-colors hover:border-brass/50"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen();
      }}
    >
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{run.driverName}</p>
            <p className="truncate text-xs text-muted">
              {run.code}
              {run.vehicleLabel ? ` · ${run.vehicleLabel}` : ''}
            </p>
          </div>
          <Badge tone={RUN_STATUS_TONES[run.status] ?? 'neutral'}>
            {RUN_STATUS_LABELS[run.status] ?? run.status}
          </Badge>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
          <div
            className={cn('h-full rounded-full', run.failedCount > 0 ? 'bg-warning' : 'bg-success')}
            style={{ width: `${progress}%` }}
          />
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          <Metric label="Arrêts" value={String(run.stopCount)} />
          <Metric label="Livrés" value={String(run.deliveredCount)} tone="success" />
          <Metric label="Échecs" value={String(run.failedCount)} tone={run.failedCount > 0 ? 'danger' : undefined} />
        </dl>

        <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
          <span className="flex items-center gap-1.5 text-muted">
            <MapPin className="h-3.5 w-3.5" />
            {run.distanceKm} km
          </span>
          <span className="tabular-nums">
            {formatDa(run.collectedCashMinor)}
            <span className="text-muted"> / {formatDa(run.expectedCashMinor)}</span>
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted">{label}</dt>
      <dd
        className={cn(
          'text-lg font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function CreateRunDialog({
  open,
  date,
  drivers,
  onClose,
  onCreated,
}: {
  open: boolean;
  date: string;
  drivers: Array<{ id: string; fullName: string; openRunId: string | null }>;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const vehicles = useQuery({
    queryKey: ['admin', 'vehicles'],
    queryFn: delivery.listVehicles,
    enabled: open,
    staleTime: 300_000,
  });

  async function submit() {
    setBusy(true);
    try {
      const run = await delivery.createRun({
        date,
        driverId,
        vehicleId: vehicleId || null,
        note: note || null,
      });
      notify.success(`Tournée ${run.code} créée`);
      onCreated(run.id);
    } catch (error) {
      notify.error(message(error, 'La création a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle tournée</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Chauffeur" required>
            <Select
              value={driverId}
              onValueChange={setDriverId}
              options={drivers.map((driver) => ({
                value: driver.id,
                label: driver.openRunId ? `${driver.fullName} (déjà en tournée)` : driver.fullName,
              }))}
              placeholder="Choisir un chauffeur"
            />
          </Field>

          <Field label="Véhicule">
            <Select
              value={vehicleId}
              onValueChange={setVehicleId}
              options={[
                { value: '', label: 'Aucun' },
                ...(vehicles.data ?? [])
                  .filter((vehicle) => vehicle.active)
                  .map((vehicle) => ({
                    value: vehicle.id,
                    label: `${vehicle.label} — ${vehicle.plate}`,
                  })),
              ]}
            />
          </Field>

          <Field label="Note">
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>

          <p className="text-xs text-muted">Les commandes s’ajoutent depuis la tournée elle-même.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!driverId} onClick={() => void submit()}>
            <Truck className="h-4 w-4" />
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
