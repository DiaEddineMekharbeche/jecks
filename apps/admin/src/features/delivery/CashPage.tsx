import type { CashHolderSummary } from '@jecks/shared';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, HandCoins, Wallet } from 'lucide-react';
import { useState } from 'react';
import { dateTimeFormatter, formatDa, message } from '@/lib/errors';
import * as delivery from './api';

/**
 * The cash drawer — PRD F-AD-64.
 *
 * Cash on delivery means the shop's money spends days in other people's pockets. This
 * screen keeps three numbers apart on purpose: what the orders say was due, what the
 * driver says they took, and what has actually been counted in at the office. A gap
 * between the first two is a conversation; a gap between the last two is just cash that
 * has not come back yet.
 */
export function CashPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [holder, setHolder] = useState<CashHolderSummary | null>(null);

  const cash = useQuery({
    queryKey: ['admin', 'cash', date],
    queryFn: () => delivery.dailyCash(date),
  });

  function shiftDay(days: number) {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    setDate(next.toISOString().slice(0, 10));
  }

  const data = cash.data;
  const variance = data ? BigInt(data.collectedMinor) - BigInt(data.expectedMinor) : 0n;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Caisse COD"
        description="Ce qui était dû, ce qui a été encaissé, et ce qui est rentré."
        actions={
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
        }
      />

      {cash.isLoading ? (
        <Skeleton className="h-64" label="Chargement de la caisse" />
      ) : !data ? (
        <EmptyState title="Rien à afficher" description="Aucun encaissement ce jour." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Attendu" value={formatDa(data.expectedMinor)} hint="commandes livrées" />
            <Tile
              label="Encaissé"
              value={formatDa(data.collectedMinor)}
              tone={variance < 0n ? 'danger' : undefined}
            />
            <Tile label="Compté en caisse" value={formatDa(data.reconciledMinor)} tone="success" />
            <Tile
              label="En circulation"
              value={formatDa(data.outstandingMinor)}
              hint="encaissé, pas encore rentré"
              tone={BigInt(data.outstandingMinor) > 0n ? 'warning' : undefined}
            />
          </div>

          {variance < 0n ? (
            <Alert tone="warning" title="Moins encaissé que prévu">
              {formatDa(-variance)} d’écart entre les commandes livrées et ce qui a été déclaré.
              L’écart vient souvent d’une livraison partielle ou d’une commande marquée livrée trop
              tôt.
            </Alert>
          ) : null}

          {data.holders.length === 0 ? (
            <EmptyState
              title="Aucun encaissement"
              description="Personne n’a collecté d’argent ce jour-là."
            />
          ) : (
            <Card>
              <CardBody className="p-0">
                <ul className="divide-y divide-line">
                  {data.holders.map((entry) => (
                    <li
                      key={`${entry.kind}-${entry.id}`}
                      className="flex flex-wrap items-center gap-3 px-4 py-3"
                    >
                      <span
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-full',
                          entry.kind === 'driver' ? 'bg-brass/15 text-brass' : 'bg-info/15 text-info',
                        )}
                      >
                        {entry.kind === 'driver' ? (
                          <HandCoins className="h-4 w-4" />
                        ) : (
                          <Wallet className="h-4 w-4" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink">{entry.name}</p>
                        <p className="text-xs text-muted">
                          {entry.kind === 'driver' ? 'Chauffeur' : 'Transporteur'} ·{' '}
                          {entry.orderCount} commande(s)
                        </p>
                      </div>

                      <dl className="flex items-center gap-6 text-sm">
                        <div className="text-end">
                          <dt className="text-[11px] uppercase tracking-wider text-muted">Encaissé</dt>
                          <dd className="tabular-nums">{formatDa(entry.collectedMinor)}</dd>
                        </div>
                        <div className="text-end">
                          <dt className="text-[11px] uppercase tracking-wider text-muted">En main</dt>
                          <dd
                            className={cn(
                              'tabular-nums',
                              BigInt(entry.outstandingMinor) > 0n && 'text-warning',
                            )}
                          >
                            {formatDa(entry.outstandingMinor)}
                          </dd>
                        </div>
                      </dl>

                      <Button
                        size="sm"
                        variant={BigInt(entry.outstandingMinor) > 0n ? 'primary' : 'outline'}
                        onClick={() => setHolder(entry)}
                      >
                        Compter
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {holder ? (
        <ReconcileDialog
          holder={holder}
          onClose={() => setHolder(null)}
          onDone={() => {
            setHolder(null);
            void cash.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Counting cash in, one collection at a time.
 *
 * Deliberately itemised rather than a single "mark all settled" button: the office
 * counts notes against a list of orders, and a discrepancy has to be attributable to
 * one delivery rather than to a day.
 */
function ReconcileDialog({
  holder,
  onClose,
  onDone,
}: {
  holder: CashHolderSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const outstanding = useQuery({
    queryKey: ['admin', 'cash', 'outstanding', holder.kind, holder.id],
    queryFn: () => delivery.outstandingCash(holder.kind, holder.id),
  });

  const rows = outstanding.data ?? [];
  const total = rows
    .filter((row) => selected.includes(row.id))
    .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);

  async function submit() {
    setBusy(true);
    try {
      const result = await delivery.reconcileCash({ collectionIds: selected });
      notify.success(`${result.reconciled} encaissement(s) comptés, ${formatDa(result.amountMinor)}`);
      onDone();
    } catch (error) {
      notify.error(message(error, 'Le comptage a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compter la caisse — {holder.name}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {outstanding.isLoading ? (
            <Skeleton className="h-40" label="Chargement des encaissements" />
          ) : rows.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-sm text-muted">
              Rien à compter : tout est déjà rentré.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelected(selected.length === rows.length ? [] : rows.map((row) => row.id))
                  }
                >
                  {selected.length === rows.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                </Button>
                <span className="text-sm tabular-nums">
                  {selected.length} sélectionné(s) · <strong>{formatDa(total.toString())}</strong>
                </span>
              </div>

              <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line">
                {rows.map((row) => {
                  const checked = selected.includes(row.id);
                  return (
                    <li key={row.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-elevated">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() =>
                            setSelected((current) =>
                              checked
                                ? current.filter((entry) => entry !== row.id)
                                : [...current, row.id],
                            )
                          }
                          aria-label={`Sélectionner ${row.orderNumber}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{row.orderNumber}</p>
                          <p className="truncate text-xs text-muted">
                            {row.customerName} ·{' '}
                            {dateTimeFormatter.format(new Date(row.collectedAt))}
                          </p>
                        </div>
                        <span className="whitespace-nowrap text-sm tabular-nums">
                          {formatDa(row.amountMinor)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button loading={busy} disabled={selected.length === 0} onClick={() => void submit()}>
            Encaisser {formatDa(total.toString())}
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
  tone?: 'success' | 'danger' | 'warning';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
