import { DeliveryFailureReason, type DeliveryRunStopDto } from '@jecks/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  MoneyInput,
  Select,
  Skeleton,
  Textarea,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, MapPin, MessageCircle, Navigation, Phone, XCircle } from 'lucide-react';
import { useState } from 'react';
import { formatDa, message } from '@/lib/errors';
import * as delivery from './api';
import { FAILURE_LABELS, STOP_STATUS_LABELS, STOP_STATUS_TONES, mapsLink, wazeLink } from './labels';

/**
 * The driver's phone — PRD F-AD-63.
 *
 * Everything here assumes one hand, sunlight and a hurry: large targets, one stop
 * expanded at a time, and the two buttons that matter sized so they cannot be missed.
 *
 * The run comes from the session rather than a URL, so a driver can only ever see their
 * own — acceptance criterion 6, enforced by the API and not by hiding a link.
 */
export function DriverPage() {
  const [reporting, setReporting] = useState<DeliveryRunStopDto | null>(null);

  const run = useQuery({ queryKey: ['driver', 'run'], queryFn: delivery.myRun });

  if (run.isLoading) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-4">
        <Skeleton className="h-24" label="Chargement de la tournée" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (run.error) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <EmptyState
          title="Impossible de charger la tournée"
          description={(run.error as Error).message}
          action={
            <Button size="sm" variant="outline" onClick={() => void run.refetch()}>
              Réessayer
            </Button>
          }
        />
      </div>
    );
  }

  const data = run.data;

  if (!data) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <EmptyState
          title="Aucune tournée aujourd’hui"
          description="Rien ne vous est assigné pour le moment."
        />
      </div>
    );
  }

  const remaining = data.stops.filter((stop) => stop.status === 'PENDING' || stop.status === 'ARRIVED');
  const done = data.stops.filter((stop) => !remaining.includes(stop));

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-4 pb-24">
      <header className="rounded-lg border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-lg font-semibold">{data.code}</p>
            <p className="text-sm text-muted">
              {data.date}
              {data.vehicleLabel ? ` · ${data.vehicleLabel}` : ''}
            </p>
          </div>
          <Badge tone="brass">{remaining.length} restant(s)</Badge>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-muted">Livrés</dt>
            <dd className="text-lg font-semibold tabular-nums text-success">
              {data.deliveredCount}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-muted">Échecs</dt>
            <dd className="text-lg font-semibold tabular-nums text-danger">{data.failedCount}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-muted">Encaissé</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatDa(data.collectedCashMinor)}
            </dd>
          </div>
        </dl>
      </header>

      {remaining.length === 0 ? (
        <EmptyState
          title="Tournée terminée"
          description={`${formatDa(data.collectedCashMinor)} à remettre à la caisse.`}
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {remaining.map((stop) => (
            <StopCard key={stop.id} stop={stop} onReport={() => setReporting(stop)} />
          ))}
        </ol>
      )}

      {done.length > 0 ? (
        <details className="rounded-lg border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            {done.length} arrêt(s) clôturé(s)
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {done.map((stop) => (
              <li key={stop.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-sm text-muted">{stop.position}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{stop.customerName}</p>
                  <p className="truncate text-xs text-muted">{stop.orderNumber}</p>
                </div>
                <Badge tone={STOP_STATUS_TONES[stop.status] ?? 'neutral'}>
                  {STOP_STATUS_LABELS[stop.status] ?? stop.status}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {reporting ? (
        <ReportSheet
          runId={data.id}
          stop={reporting}
          onClose={() => setReporting(null)}
          onDone={() => {
            setReporting(null);
            void run.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function StopCard({ stop, onReport }: { stop: DeliveryRunStopDto; onReport: () => void }) {
  const due = BigInt(stop.codAmountMinor);

  return (
    <li className="rounded-lg border border-line bg-surface">
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brass/15 text-sm font-semibold text-brass">
          {stop.position}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{stop.customerName}</p>
          <p className="text-sm text-muted">{stop.orderNumber}</p>
          <p className="mt-1 flex items-start gap-1.5 text-sm">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
            <span>
              {stop.address ?? '—'}
              {stop.communeName ? `, ${stop.communeName}` : ''}
            </span>
          </p>
          {stop.note ? <p className="mt-1 text-xs italic text-muted">{stop.note}</p> : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
        <span className="text-lg font-semibold tabular-nums">
          {due > 0n ? formatDa(stop.codAmountMinor) : <span className="text-success">payé</span>}
        </span>
        <span className="text-xs text-muted">{stop.itemCount} article(s)</span>
      </div>

      <div className="grid grid-cols-4 gap-1 border-t border-line p-2">
        <IconLink href={`tel:${stop.customerPhone}`} label="Appeler">
          <Phone className="h-5 w-5" />
        </IconLink>
        <IconLink
          href={`https://wa.me/${stop.customerPhone.replace(/[^\d]/g, '')}`}
          label="WhatsApp"
          external
        >
          <MessageCircle className="h-5 w-5" />
        </IconLink>
        <IconLink
          href={wazeLink(stop.latitude, stop.longitude, stop.address)}
          label="Waze"
          external
        >
          <Navigation className="h-5 w-5" />
        </IconLink>
        <IconLink
          href={mapsLink(stop.latitude, stop.longitude, stop.address)}
          label="Maps"
          external
        >
          <MapPin className="h-5 w-5" />
        </IconLink>
      </div>

      <div className="p-2 pt-0">
        <Button className="h-12 w-full text-base" onClick={onReport}>
          Clôturer cet arrêt
        </Button>
      </div>
    </li>
  );
}

function IconLink({
  href,
  label,
  external,
  children,
}: {
  href: string;
  label: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className="flex flex-col items-center gap-1 rounded-md py-2 text-muted transition-colors hover:bg-elevated hover:text-ink"
    >
      {children}
      <span className="text-[11px]">{label}</span>
    </a>
  );
}

/**
 * Reporting an outcome, sized for a thumb.
 *
 * Delivered and failed are the two big buttons, and the cash field is pre-filled with
 * what is due: the common case is one tap, and typing a number at a doorstep is what
 * gets skipped.
 */
function ReportSheet({
  runId,
  stop,
  onClose,
  onDone,
}: {
  runId: string;
  stop: DeliveryRunStopDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const due = BigInt(stop.codAmountMinor);
  const [outcome, setOutcome] = useState<'DELIVERED' | 'FAILED' | null>(null);
  const [cash, setCash] = useState<bigint | null>(due);
  const [reason, setReason] = useState<string>(DeliveryFailureReason.NO_ANSWER);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(status: 'DELIVERED' | 'FAILED' | 'RESCHEDULED') {
    setBusy(true);
    try {
      await delivery.reportStop(runId, stop.id, {
        status,
        ...(status === 'DELIVERED' ? { cashCollected: (cash ?? due).toString() } : {}),
        ...(status === 'FAILED' ? { failureReason: reason } : {}),
        note: note || null,
      });
      notify.success(status === 'DELIVERED' ? 'Livraison enregistrée' : 'Arrêt clôturé');
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
          <DialogTitle>{stop.customerName}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {outcome === null ? (
            <div className="grid grid-cols-1 gap-3">
              <Button className="h-16 text-base" onClick={() => setOutcome('DELIVERED')}>
                <CheckCircle2 className="h-6 w-6" />
                Livré
              </Button>
              <Button
                variant="danger"
                className="h-16 text-base"
                onClick={() => setOutcome('FAILED')}
              >
                <XCircle className="h-6 w-6" />
                Non livré
              </Button>
              <Button
                variant="outline"
                className="h-12"
                loading={busy}
                onClick={() => void submit('RESCHEDULED')}
              >
                Reporter à plus tard
              </Button>
            </div>
          ) : outcome === 'DELIVERED' ? (
            <>
              <Field
                label="Montant encaissé"
                hint={due > 0n ? `Attendu : ${formatDa(stop.codAmountMinor)}` : 'Déjà payée.'}
              >
                <MoneyInput value={cash ?? due} onValueChange={setCash} className="h-14 text-xl" />
              </Field>

              {cash !== null && cash < due ? (
                <p className="text-sm text-warning">
                  Il manque {formatDa((due - cash).toString())} par rapport à la commande.
                </p>
              ) : null}

              <Field label="Note">
                <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
              </Field>

              <Button
                className="h-14 text-base"
                loading={busy}
                onClick={() => void submit('DELIVERED')}
              >
                Confirmer la livraison
              </Button>
            </>
          ) : (
            <>
              <Field label="Que s’est-il passé ?" required>
                <Select
                  value={reason}
                  onValueChange={setReason}
                  options={Object.entries(FAILURE_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Field>

              <Field label="Note">
                <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
              </Field>

              <Button
                variant="danger"
                className="h-14 text-base"
                loading={busy}
                onClick={() => void submit('FAILED')}
              >
                Enregistrer l’échec
              </Button>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => (outcome === null ? onClose() : setOutcome(null))}
            className={cn('w-full')}
          >
            {outcome === null ? 'Fermer' : 'Retour'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
