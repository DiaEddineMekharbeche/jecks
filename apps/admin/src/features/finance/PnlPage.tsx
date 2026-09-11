import { PNL_GROUPINGS, type PnlGrouping, type PnlLine } from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
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
import { Download, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { download } from '@/lib/api';
import { formatDa, message } from '@/lib/errors';
import * as finance from './api';

/**
 * Profit and loss — PRD F-AD-70.
 *
 * The waterfall is the point: an owner needs to see where the money went, not just what
 * was left. Every line is a subtraction they can argue with, in the order the money
 * actually leaves.
 */

const GROUPING_LABELS: Record<PnlGrouping, string> = {
  day: 'Jour',
  week: 'Semaine',
  month: 'Mois',
  product: 'Produit',
  category: 'Catégorie',
  collection: 'Collection',
  wilaya: 'Wilaya',
  channel: 'Canal',
  courier: 'Transporteur',
};

export function PnlPage() {
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 29);
    return date.toISOString().slice(0, 10);
  });
  const [groupBy, setGroupBy] = useState<PnlGrouping>('day');
  const [compare, setCompare] = useState(true);

  const report = useQuery({
    queryKey: ['admin', 'pnl', from, to, groupBy, compare],
    queryFn: () => finance.pnl({ from, to, groupBy, compare }),
  });

  const data = report.data;

  async function exportRows(format: 'csv' | 'xlsx') {
    try {
      await download('/admin/finance/pnl', {
        query: { from, to, groupBy, format },
      });
      notify.success(`Export ${format.toUpperCase()} téléchargé`);
    } catch (error) {
      notify.error(message(error, "L'export a échoué"));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Résultat"
        description="Ce qui est entré, ce qui est sorti, et ce qui reste."
        actions={
          <>
            <Field label="Du" className="w-[150px]">
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="Au" className="w-[150px]">
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
            <Field label="Grouper par" className="w-[170px]">
              <Select
                value={groupBy}
                onValueChange={(value) => setGroupBy(value as PnlGrouping)}
                options={PNL_GROUPINGS.map((value) => ({
                  value,
                  label: GROUPING_LABELS[value],
                }))}
              />
            </Field>
            <Button variant="outline" size="sm" onClick={() => void exportRows('xlsx')}>
              <Download className="h-4 w-4" />
              Exporter
            </Button>
          </>
        }
      />

      <SwitchField
        label="Comparer à la période précédente"
        description="La même durée, juste avant."
        checked={compare}
        onCheckedChange={setCompare}
      />

      {report.isLoading ? (
        <Skeleton className="h-96" label="Calcul du résultat" />
      ) : report.error ? (
        <EmptyState
          title="Impossible de calculer le résultat"
          description={(report.error as Error).message}
          action={
            <Button size="sm" variant="outline" onClick={() => void report.refetch()}>
              Réessayer
            </Button>
          }
        />
      ) : !data ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile
              label="Chiffre d’affaires"
              value={formatDa(data.revenueMinor)}
              change={data.changes?.revenuePercent}
            />
            <Tile
              label="Marge brute"
              value={formatDa(data.grossProfitMinor)}
              hint={`${data.grossMarginPercent} % du CA`}
            />
            <Tile
              label="Résultat net"
              value={formatDa(data.netProfitMinor)}
              hint={`${data.netMarginPercent} % du CA`}
              change={data.changes?.netProfitPercent}
              tone={BigInt(data.netProfitMinor) >= 0n ? 'success' : 'danger'}
            />
            <Tile
              label="Commandes"
              value={String(data.orders)}
              hint={`${data.units} article(s)`}
              change={data.changes?.ordersPercent}
            />
          </div>

          <Alert tone="info" title={`Base : commandes ${data.basis === 'paid' ? 'payées' : 'livrées'}`}>
            {data.basis === 'delivered'
              ? 'Une commande passée n’est pas un chiffre d’affaires tant que le colis n’est pas remis et l’argent encaissé.'
              : 'Le chiffre d’affaires est compté au paiement. Modifiable dans Réglages › Finance.'}
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Du chiffre d’affaires au résultat</CardTitle>
            </CardHeader>
            <CardBody>
              <Waterfall line={data} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Par {GROUPING_LABELS[data.groupBy].toLowerCase()}</CardTitle>
            </CardHeader>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-3 text-start font-medium">
                      {GROUPING_LABELS[data.groupBy]}
                    </th>
                    <th className="px-4 py-3 text-end font-medium">Cmd.</th>
                    <th className="px-4 py-3 text-end font-medium">CA</th>
                    <th className="px-4 py-3 text-end font-medium">Marge brute</th>
                    <th className="px-4 py-3 text-end font-medium">Marge %</th>
                    <th className="px-4 py-3 text-end font-medium">Livraison</th>
                    <th className="px-4 py-3 text-end font-medium">Charges</th>
                    <th className="px-4 py-3 text-end font-medium">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.rows.map((row) => (
                    <tr key={row.key} className="hover:bg-elevated/50">
                      <td className="px-4 py-2">{row.label}</td>
                      <td className="px-4 py-2 text-end tabular-nums text-muted">{row.orders}</td>
                      <td className="px-4 py-2 text-end tabular-nums">
                        {formatDa(row.revenueMinor)}
                      </td>
                      <td className="px-4 py-2 text-end tabular-nums">
                        {formatDa(row.grossProfitMinor)}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2 text-end tabular-nums',
                          row.grossMarginPercent < 30 && 'text-warning',
                        )}
                      >
                        {row.grossMarginPercent} %
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2 text-end tabular-nums',
                          BigInt(row.shippingMarginMinor) < 0n ? 'text-danger' : 'text-muted',
                        )}
                      >
                        {formatDa(row.shippingMarginMinor)}
                      </td>
                      <td className="px-4 py-2 text-end tabular-nums text-muted">
                        {formatDa(
                          (BigInt(row.expensesMinor) + BigInt(row.adSpendMinor)).toString(),
                        )}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2 text-end font-medium tabular-nums',
                          BigInt(row.netProfitMinor) < 0n ? 'text-danger' : 'text-success',
                        )}
                      >
                        {formatDa(row.netProfitMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>

          {data.rows.some((row) => BigInt(row.expensesMinor) > 0n) ? (
            <p className="text-xs text-muted">
              Les charges de la période sont réparties entre les lignes au prorata du chiffre
              d’affaires : le loyer n’appartient à aucune wilaya, mais l’ignorer flatte chaque ligne.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Revenue down to net profit, each step showing what it took away.
 *
 * A bar chart of these would compare a positive revenue with negative costs and read
 * badly; a list where each row is a subtraction reads the way an accountant says it.
 */
function Waterfall({ line }: { line: PnlLine }) {
  const revenue = BigInt(line.revenueMinor);

  const steps: Array<{ label: string; amount: bigint; kind: 'in' | 'out' | 'total' }> = [
    { label: 'Chiffre d’affaires', amount: revenue, kind: 'in' },
    { label: 'Coût des marchandises', amount: -BigInt(line.cogsMinor), kind: 'out' },
    { label: 'Marge brute', amount: BigInt(line.grossProfitMinor), kind: 'total' },
    { label: 'Livraison encaissée', amount: BigInt(line.shippingRevenueMinor), kind: 'in' },
    { label: 'Coût du transport', amount: -BigInt(line.shippingCostMinor), kind: 'out' },
    { label: 'Frais de paiement', amount: -BigInt(line.paymentFeesMinor), kind: 'out' },
    { label: 'Remboursements', amount: -BigInt(line.refundsMinor), kind: 'out' },
    { label: 'Charges', amount: -BigInt(line.expensesMinor), kind: 'out' },
    { label: 'Publicité', amount: -BigInt(line.adSpendMinor), kind: 'out' },
    { label: 'Résultat net', amount: BigInt(line.netProfitMinor), kind: 'total' },
  ];

  const widest = steps.reduce((max, step) => {
    const size = step.amount < 0n ? -step.amount : step.amount;
    return size > max ? size : max;
  }, 1n);

  return (
    <ul className="flex flex-col gap-1.5">
      {steps.map((step) => {
        const size = step.amount < 0n ? -step.amount : step.amount;
        const width = Number((size * 100n) / widest);

        return (
          <li
            key={step.label}
            className={cn(
              'flex items-center gap-3 rounded-sm px-2 py-1.5',
              step.kind === 'total' && 'border-t border-line bg-elevated/40 font-medium',
            )}
          >
            <span className="w-52 shrink-0 text-sm">{step.label}</span>
            <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-elevated">
              <span
                className={cn(
                  'absolute inset-y-0 start-0 rounded-full',
                  step.kind === 'out'
                    ? 'bg-danger/60'
                    : step.kind === 'total'
                      ? 'bg-brass'
                      : 'bg-success/60',
                )}
                style={{ width: `${width}%` }}
              />
            </span>
            <span
              className={cn(
                'w-36 shrink-0 text-end text-sm tabular-nums',
                step.kind === 'out' && 'text-danger',
                step.kind === 'total' && 'font-semibold',
              )}
            >
              {formatDa(step.amount.toString())}
            </span>
          </li>
        );
      })}

      <li className="mt-1 flex items-center gap-3 px-2 text-xs text-muted">
        <span className="w-52 shrink-0">Remises accordées</span>
        <span className="flex-1" />
        <span className="w-36 shrink-0 text-end tabular-nums">
          {formatDa(line.discountsMinor)}
        </span>
      </li>
      <li className="px-2 text-[11px] text-muted">
        Déjà déduites du chiffre d’affaires ; affichées ici pour mémoire.
      </li>
    </ul>
  );
}

function Tile({
  label,
  value,
  hint,
  change,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  change?: number | null;
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
      <div className="mt-0.5 flex items-center gap-2">
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
        {change !== null && change !== undefined ? (
          <Badge tone={change >= 0 ? 'success' : 'danger'}>
            {change >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {Math.abs(change)} %
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
