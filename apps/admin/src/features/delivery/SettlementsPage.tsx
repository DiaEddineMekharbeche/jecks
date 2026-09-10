import type { SettlementDto } from '@jecks/shared';
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
  MoneyInput,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { dateFormatter, formatDa, message } from '@/lib/errors';
import * as delivery from './api';
import { SETTLEMENT_STATUS_LABELS, SETTLEMENT_STATUS_TONES } from './labels';

/**
 * Courier settlements — PRD F-AD-64.
 *
 * A courier collects our cash and pays it back weeks later, minus their fees. This is
 * the claim: every delivered parcel in a period, what they kept, and what is still
 * owed. The difference column is the one that gets a phone call made.
 */
export function SettlementsPage() {
  const [generating, setGenerating] = useState(false);
  const [paying, setPaying] = useState<SettlementDto | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const settlements = useQuery({
    queryKey: ['admin', 'settlements'],
    queryFn: () => delivery.listSettlements(),
  });

  const couriers = useQuery({
    queryKey: ['admin', 'couriers'],
    queryFn: delivery.listCouriers,
    staleTime: 300_000,
  });

  async function remove(settlement: SettlementDto) {
    if (!window.confirm(`Supprimer le règlement ${settlement.reference} ?`)) return;
    try {
      await delivery.deleteSettlement(settlement.id);
      notify.success('Règlement supprimé');
      void settlements.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  const owed = (settlements.data ?? [])
    .filter((entry) => entry.status !== 'PAID')
    .reduce((sum, entry) => sum + BigInt(entry.differenceMinor), 0n);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Règlements transporteurs"
        description="Ce que les transporteurs nous doivent, période par période."
        actions={
          <Button size="sm" onClick={() => setGenerating(true)}>
            <Plus className="h-4 w-4" />
            Générer un règlement
          </Button>
        }
      />

      {owed > 0n ? (
        <Alert tone="info" title={`${formatDa(owed.toString())} en attente de règlement`}>
          Somme des écarts sur les règlements non soldés.
        </Alert>
      ) : null}

      {settlements.isLoading ? (
        <Skeleton className="h-64" label="Chargement des règlements" />
      ) : (settlements.data ?? []).length === 0 ? (
        <EmptyState
          title="Aucun règlement"
          description="Générez-en un pour un transporteur et une période une fois les colis livrés."
          action={
            <Button size="sm" onClick={() => setGenerating(true)}>
              <Plus className="h-4 w-4" />
              Générer un règlement
            </Button>
          }
        />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 text-start font-medium">Référence</th>
                  <th className="px-4 py-3 text-start font-medium">Transporteur</th>
                  <th className="px-4 py-3 text-start font-medium">Période</th>
                  <th className="px-4 py-3 text-end font-medium">Encaissé</th>
                  <th className="px-4 py-3 text-end font-medium">Frais</th>
                  <th className="px-4 py-3 text-end font-medium">Net dû</th>
                  <th className="px-4 py-3 text-end font-medium">Écart</th>
                  <th className="px-4 py-3 text-start font-medium">État</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {settlements.data!.map((settlement) => (
                  <tr
                    key={settlement.id}
                    className="cursor-pointer hover:bg-elevated/50"
                    onClick={() => setDetail(settlement.id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{settlement.reference}</td>
                    <td className="px-4 py-3">{settlement.courierName}</td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {dateFormatter.format(new Date(settlement.periodFrom))} →{' '}
                      {dateFormatter.format(new Date(settlement.periodTo))}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {formatDa(settlement.grossAmountMinor)}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">
                      −{formatDa(settlement.feesAmountMinor)}
                    </td>
                    <td className="px-4 py-3 text-end font-medium tabular-nums">
                      {formatDa(settlement.netAmountMinor)}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-3 text-end tabular-nums',
                        BigInt(settlement.differenceMinor) > 0n && 'text-warning',
                        BigInt(settlement.differenceMinor) < 0n && 'text-danger',
                      )}
                    >
                      {formatDa(settlement.differenceMinor)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={SETTLEMENT_STATUS_TONES[settlement.status] ?? 'neutral'}>
                        {SETTLEMENT_STATUS_LABELS[settlement.status] ?? settlement.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(event) => event.stopPropagation()}
                        role="presentation"
                      >
                        {settlement.status !== 'PAID' ? (
                          <Button size="sm" onClick={() => setPaying(settlement)}>
                            Encaisser
                          </Button>
                        ) : null}
                        {BigInt(settlement.paidAmountMinor) === 0n ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Supprimer"
                            onClick={() => void remove(settlement)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <GenerateDialog
        open={generating}
        couriers={(couriers.data ?? []).filter((courier) => courier.active)}
        onClose={() => setGenerating(false)}
        onCreated={(id) => {
          setGenerating(false);
          setDetail(id);
          void settlements.refetch();
        }}
      />

      {paying ? (
        <PayDialog
          settlement={paying}
          onClose={() => setPaying(null)}
          onPaid={() => {
            setPaying(null);
            void settlements.refetch();
          }}
        />
      ) : null}

      {detail ? <DetailDialog id={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function GenerateDialog({
  open,
  couriers,
  onClose,
  onCreated,
}: {
  open: boolean;
  couriers: Array<{ id: string; name: string; settlementDays: number }>;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [courierId, setCourierId] = useState('');
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 7);
    return date.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const settlement = await delivery.generateSettlement({ courierId, from, to });
      notify.success(`Règlement ${settlement.reference} généré`);
      onCreated(settlement.id);
    } catch (error) {
      notify.error(message(error, 'La génération a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Générer un règlement</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Alert tone="info" title="Colis livrés et non encore réglés">
            Un colis déjà présent sur un autre règlement est ignoré, ce qui rend une période
            chevauchante sans danger.
          </Alert>

          <Field label="Transporteur" required>
            <Select
              value={courierId}
              onValueChange={setCourierId}
              options={couriers.map((courier) => ({ value: courier.id, label: courier.name }))}
              placeholder="Choisir"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Du" required>
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="Au" required>
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!courierId} onClick={() => void submit()}>
            <FileText className="h-4 w-4" />
            Générer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({
  settlement,
  onClose,
  onPaid,
}: {
  settlement: SettlementDto;
  onClose: () => void;
  onPaid: () => void;
}) {
  const remaining = BigInt(settlement.differenceMinor);
  const [amount, setAmount] = useState<bigint | null>(remaining > 0n ? remaining : 0n);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await delivery.paySettlement(settlement.id, {
        paidAmount: (amount ?? 0n).toString(),
        note: note || undefined,
      });
      notify.success('Paiement enregistré');
      onPaid();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  const shortfall = remaining - (amount ?? 0n);

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encaisser — {settlement.reference}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row label="Net dû" value={formatDa(settlement.netAmountMinor)} />
            <Row label="Déjà reçu" value={formatDa(settlement.paidAmountMinor)} />
            <Row label="Reste" value={formatDa(settlement.differenceMinor)} strong />
          </dl>

          <Field label="Montant reçu">
            <MoneyInput value={amount ?? ''} onValueChange={setAmount} />
          </Field>

          {shortfall > 0n ? (
            <Alert tone="warning" title={`${formatDa(shortfall.toString())} resteront dus`}>
              Le règlement passera en litige jusqu’à ce que l’écart soit soldé.
            </Alert>
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

function DetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const settlement = useQuery({
    queryKey: ['admin', 'settlement', id],
    queryFn: () => delivery.getSettlement(id),
  });

  const data = settlement.data;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{data?.reference ?? 'Règlement'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {settlement.isLoading ? (
            <Skeleton className="h-64" label="Chargement du règlement" />
          ) : !data ? (
            <p className="text-sm text-muted">Introuvable.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="Encaissé" value={formatDa(data.grossAmountMinor)} />
                <Tile label="Frais" value={formatDa(data.feesAmountMinor)} />
                <Tile label="Net dû" value={formatDa(data.netAmountMinor)} />
                <Tile label="Reçu" value={formatDa(data.paidAmountMinor)} />
              </dl>

              <div className="max-h-80 overflow-y-auto rounded-md border border-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                      <th className="px-3 py-2 text-start font-medium">Commande</th>
                      <th className="px-3 py-2 text-start font-medium">Livrée</th>
                      <th className="px-3 py-2 text-end font-medium">Encaissé</th>
                      <th className="px-3 py-2 text-end font-medium">Frais</th>
                      <th className="px-3 py-2 text-end font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(data.lines ?? []).map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2 font-mono text-xs">{line.orderNumber}</td>
                        <td className="px-3 py-2 text-xs text-muted">
                          {line.deliveredAt
                            ? dateFormatter.format(new Date(line.deliveredAt))
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums">
                          {formatDa(line.codAmountMinor)}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums text-muted">
                          −{formatDa(line.feeAmountMinor)}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums">
                          {formatDa(line.netAmountMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.note ? <p className="text-sm text-muted">{data.note}</p> : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2',
        strong && 'border-t border-line pt-1.5 font-semibold',
      )}
    >
      <dt className={cn(!strong && 'text-muted')}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}
