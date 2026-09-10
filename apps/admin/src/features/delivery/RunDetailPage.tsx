import { DeliveryFailureReason, type DeliveryRunDto, type DeliveryRunStopDto } from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  MoneyInput,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Flag,
  Navigation,
  Phone,
  Play,
  Plus,
  Printer,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDa, message } from '@/lib/errors';
import * as delivery from './api';
import {
  FAILURE_LABELS,
  RUN_STATUS_LABELS,
  RUN_STATUS_TONES,
  STOP_STATUS_LABELS,
  STOP_STATUS_TONES,
  wazeLink,
} from './labels';

/**
 * One round, stop by stop — PRD F-AD-62/63.
 *
 * The order of the list is the order the driver will drive. It can be dragged by hand
 * with the arrows, or ordered by distance in one click; the manifest prints exactly
 * what is on screen, which is what makes the paper and the app agree.
 */
export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [reporting, setReporting] = useState<DeliveryRunStopDto | null>(null);

  const run = useQuery({
    queryKey: ['admin', 'delivery-run', id],
    queryFn: () => delivery.getRun(id!),
    enabled: Boolean(id),
  });

  async function act(action: () => Promise<DeliveryRunDto>, success: string) {
    setBusy(true);
    try {
      await action();
      notify.success(success);
      await run.refetch();
    } catch (error) {
      notify.error(message(error, "L'opération a échoué"));
    } finally {
      setBusy(false);
    }
  }

  async function move(stop: DeliveryRunStopDto, direction: -1 | 1) {
    const stops = run.data?.stops ?? [];
    const index = stops.findIndex((entry) => entry.id === stop.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= stops.length) return;

    const ordered = [...stops];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved!);

    await act(
      () => delivery.reorderStops(id!, { stopIds: ordered.map((entry) => entry.id) }),
      'Ordre mis à jour',
    );
  }

  if (run.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" label="Chargement de la tournée" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (run.error || !run.data) {
    return (
      <EmptyState
        title="Tournée introuvable"
        description={(run.error as Error | undefined)?.message ?? ''}
        action={
          <Button variant="outline" size="sm" onClick={() => navigate('/delivery/runs')}>
            Retour aux tournées
          </Button>
        }
      />
    );
  }

  const data = run.data;
  const editable = data.status === 'PLANNED' || data.status === 'IN_PROGRESS';
  const variance = BigInt(data.collectedCashMinor) - BigInt(data.expectedCashMinor);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Retour"
              onClick={() => navigate('/delivery/runs')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {data.code}
            <Badge tone={RUN_STATUS_TONES[data.status] ?? 'neutral'}>
              {RUN_STATUS_LABELS[data.status] ?? data.status}
            </Badge>
          </span>
        }
        description={`${data.driverName} · ${data.driverPhone}${
          data.vehicleLabel ? ` · ${data.vehicleLabel}` : ''
        } · ${data.date}`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void delivery
                  .printManifest(data.id)
                  .catch((error) => notify.error(message(error, "L'impression a échoué")))
              }
            >
              <Printer className="h-4 w-4" />
              Feuille de route
            </Button>
            {editable ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  loading={busy}
                  disabled={data.stopCount < 2}
                  onClick={() => void act(() => delivery.optimiseRun(data.id), 'Tournée optimisée')}
                >
                  <Wand2 className="h-4 w-4" />
                  Optimiser
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                  <Plus className="h-4 w-4" />
                  Ajouter des commandes
                </Button>
              </>
            ) : null}
            {data.status === 'PLANNED' ? (
              <Button
                size="sm"
                loading={busy}
                onClick={() => void act(() => delivery.startRun(data.id), 'Tournée démarrée')}
              >
                <Play className="h-4 w-4" />
                Démarrer
              </Button>
            ) : null}
            {data.status === 'IN_PROGRESS' ? (
              <Button
                size="sm"
                loading={busy}
                onClick={() => void act(() => delivery.completeRun(data.id), 'Tournée clôturée')}
              >
                <Flag className="h-4 w-4" />
                Clôturer
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Arrêts" value={String(data.stopCount)} />
        <Tile label="Livrés" value={String(data.deliveredCount)} tone="success" />
        <Tile
          label="Échecs"
          value={String(data.failedCount)}
          tone={data.failedCount > 0 ? 'danger' : undefined}
        />
        <Tile label="Distance" value={`${data.distanceKm} km`} hint="à vol d’oiseau" />
        <Tile
          label="Encaissé"
          value={formatDa(data.collectedCashMinor)}
          hint={`attendu ${formatDa(data.expectedCashMinor)}`}
          tone={variance < 0n ? 'danger' : undefined}
        />
      </div>

      {data.status === 'COMPLETED' && variance !== 0n ? (
        <Alert tone={variance < 0n ? 'danger' : 'warning'} title="Écart de caisse">
          {variance < 0n
            ? `Il manque ${formatDa(-variance)} par rapport aux commandes livrées.`
            : `${formatDa(variance)} de plus que prévu ont été encaissés.`}
        </Alert>
      ) : null}

      {data.stops.length === 0 ? (
        <EmptyState
          title="Aucun arrêt"
          description="Ajoutez les commandes à livrer, puis optimisez l’ordre."
          action={
            editable ? (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Ajouter des commandes
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Itinéraire</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <ol className="divide-y divide-line">
              {data.stops.map((stop, index) => (
                <StopRow
                  key={stop.id}
                  stop={stop}
                  first={index === 0}
                  last={index === data.stops.length - 1}
                  editable={editable}
                  onMove={(direction) => void move(stop, direction)}
                  onRemove={() =>
                    void act(() => delivery.unassignStop(data.id, stop.id), 'Arrêt retiré')
                  }
                  onReport={() => setReporting(stop)}
                />
              ))}
            </ol>
          </CardBody>
        </Card>
      )}

      <AddOrdersDialog
        open={adding}
        runId={data.id}
        date={data.date}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          void run.refetch();
        }}
      />

      <ReportDialog
        runId={data.id}
        stop={reporting}
        onClose={() => setReporting(null)}
        onDone={() => {
          setReporting(null);
          void run.refetch();
        }}
      />
    </div>
  );
}

function StopRow({
  stop,
  first,
  last,
  editable,
  onMove,
  onRemove,
  onReport,
}: {
  stop: DeliveryRunStopDto;
  first: boolean;
  last: boolean;
  editable: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onReport: () => void;
}) {
  const closed = stop.status === 'DELIVERED' || stop.status === 'FAILED' || stop.status === 'RESCHEDULED';

  return (
    <li className="flex flex-wrap items-start gap-3 p-4">
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          closed ? 'bg-elevated text-muted' : 'bg-brass/15 text-brass',
        )}
      >
        {stop.position}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-ink">{stop.orderNumber}</p>
          <Badge tone={STOP_STATUS_TONES[stop.status] ?? 'neutral'}>
            {STOP_STATUS_LABELS[stop.status] ?? stop.status}
          </Badge>
          {stop.failureReason ? (
            <span className="text-xs text-danger">{FAILURE_LABELS[stop.failureReason]}</span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-sm">{stop.customerName}</p>
        <p className="truncate text-xs text-muted">
          {stop.address ?? '—'}
          {stop.communeName ? `, ${stop.communeName}` : ''} · {stop.wilayaName}
        </p>
        {stop.note ? <p className="mt-1 text-xs italic text-muted">{stop.note}</p> : null}
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className="whitespace-nowrap text-sm font-semibold tabular-nums">
          {BigInt(stop.codAmountMinor) > 0n ? formatDa(stop.codAmountMinor) : 'payé'}
        </span>
        {closed && BigInt(stop.cashCollectedMinor) > 0n ? (
          <span className="text-xs text-success">
            encaissé {formatDa(stop.cashCollectedMinor)}
          </span>
        ) : null}
        <span className="text-xs text-muted">{stop.itemCount} article(s)</span>
      </div>

      <div className="flex items-center gap-1">
        <a
          href={`tel:${stop.customerPhone}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-elevated hover:text-ink"
          aria-label={`Appeler ${stop.customerName}`}
        >
          <Phone className="h-4 w-4" />
        </a>
        <a
          href={wazeLink(stop.latitude, stop.longitude, stop.address)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-elevated hover:text-ink"
          aria-label="Itinéraire Waze"
        >
          <Navigation className="h-4 w-4" />
        </a>

        {editable && !closed ? (
          <>
            <Button variant="ghost" size="sm" aria-label="Monter" disabled={first} onClick={() => onMove(-1)}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" aria-label="Descendre" disabled={last} onClick={() => onMove(1)}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" aria-label="Retirer" onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={onReport}>
              <CheckCircle2 className="h-4 w-4" />
              Clôturer
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}

/** What happened at the door, entered from the office when a driver phones it in. */
function ReportDialog({
  runId,
  stop,
  onClose,
  onDone,
}: {
  runId: string;
  stop: DeliveryRunStopDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<'DELIVERED' | 'FAILED' | 'RESCHEDULED'>('DELIVERED');
  const [cash, setCash] = useState<bigint | null>(null);
  const [reason, setReason] = useState<string>(DeliveryFailureReason.NO_ANSWER);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (!stop) return null;

  const due = BigInt(stop.codAmountMinor);

  async function submit() {
    setBusy(true);
    try {
      await delivery.updateStop(runId, stop!.id, {
        status,
        ...(status === 'DELIVERED' ? { cashCollected: (cash ?? due).toString() } : {}),
        ...(status === 'FAILED' ? { failureReason: reason } : {}),
        note: note || null,
      });
      notify.success('Arrêt clôturé');
      onDone();
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
          <DialogTitle>Arrêt {stop.position} — {stop.orderNumber}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Résultat">
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as typeof status)}
              options={[
                { value: 'DELIVERED', label: 'Livré' },
                { value: 'FAILED', label: 'Échec' },
                { value: 'RESCHEDULED', label: 'Reporté' },
              ]}
            />
          </Field>

          {status === 'DELIVERED' ? (
            <Field
              label="Encaissé"
              hint={due > 0n ? `Attendu : ${formatDa(due)}` : 'Commande déjà payée.'}
            >
              <MoneyInput value={cash ?? due} onValueChange={setCash} />
            </Field>
          ) : null}

          {status === 'FAILED' ? (
            <Field label="Motif" required>
              <Select
                value={reason}
                onValueChange={setReason}
                options={Object.entries(FAILURE_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
          ) : null}

          <Field label="Note">
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
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

function AddOrdersDialog({
  open,
  runId,
  date,
  onClose,
  onAdded,
}: {
  open: boolean;
  runId: string;
  date: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [wilaya, setWilaya] = useState('');
  const [busy, setBusy] = useState(false);

  const orders = useQuery({
    queryKey: ['admin', 'delivery-runs', 'assignable', date, wilaya],
    queryFn: () =>
      delivery.assignableOrders({ date, ...(wilaya ? { wilayaCode: Number(wilaya) } : {}) }),
    enabled: open,
  });

  async function submit() {
    setBusy(true);
    try {
      await delivery.assignOrders(runId, { orderIds: selected });
      notify.success(`${selected.length} commande(s) ajoutée(s)`);
      setSelected([]);
      onAdded();
    } catch (error) {
      notify.error(message(error, "L'ajout a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Charger des commandes</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Wilaya" hint="Filtrer pour ne charger qu’une zone.">
            <Select
              value={wilaya}
              onValueChange={setWilaya}
              options={[
                { value: '', label: 'Toutes' },
                ...Array.from({ length: 58 }, (_, index) => ({
                  value: String(index + 1),
                  label: String(index + 1).padStart(2, '0'),
                })),
              ]}
            />
          </Field>

          {orders.isLoading ? (
            <Skeleton className="h-40" label="Chargement des commandes" />
          ) : (orders.data ?? []).length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-sm text-muted">
              Aucune commande confirmée n’attend d’être chargée.
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {orders.data!.map((order) => {
                const checked = selected.includes(order.id);
                const due = BigInt(order.total) - BigInt(order.paidTotal);
                return (
                  <li key={order.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-elevated">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          setSelected((current) =>
                            checked
                              ? current.filter((entry) => entry !== order.id)
                              : [...current, order.id],
                          )
                        }
                        aria-label={`Sélectionner ${order.number}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{order.number}</p>
                        <p className="truncate text-xs text-muted">
                          {order.customerName} · {order.wilayaName}
                          {order.communeName ? `, ${order.communeName}` : ''}
                        </p>
                      </div>
                      <span className="whitespace-nowrap text-sm tabular-nums">
                        {formatDa(due.toString())}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={selected.length === 0} onClick={() => void submit()}>
            Ajouter {selected.length} commande(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
