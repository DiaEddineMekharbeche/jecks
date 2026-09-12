import { Badge, Card, CardBody, CardHeader, CardTitle, Skeleton, cn } from '@jecks/ui';
import { format, money, type Money } from '@jecks/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { InsightsPanel } from './InsightsPanel';

type Period = '7d' | '30d' | '90d' | 'mtd' | 'ytd';

interface Tile {
  key: string;
  value: string | number;
  previous: string | number;
  changePercent: number | null;
}

interface SeriesPoint {
  day: string;
  ordersCount: number;
  deliveredCount: number;
  revenue: string;
  cogs: string;
  grossProfit: string;
  netProfit: string;
  adSpend: string;
}

interface Summary {
  period: Period;
  from: string;
  to: string;
  tiles: Tile[];
  series: SeriesPoint[];
  attention: Record<string, number>;
}

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: '90d', label: '90 jours' },
  { value: 'mtd', label: 'Ce mois' },
  { value: 'ytd', label: 'Cette année' },
];

/** Tiles whose value is money in centimes rather than a plain count. */
const MONEY_TILES = new Set([
  'revenue',
  'grossProfit',
  'netProfit',
  'averageOrderValue',
  'adSpend',
]);

const TILE_LABELS: Record<string, string> = {
  orders: 'Commandes',
  revenue: 'Chiffre d’affaires',
  grossProfit: 'Marge brute',
  netProfit: 'Bénéfice net',
  delivered: 'Livrées',
  averageOrderValue: 'Panier moyen',
  deliveryRate: 'Taux de livraison',
  adSpend: 'Dépenses pub',
};

const ATTENTION_LABELS: Record<string, string> = {
  pendingConfirmation: 'À confirmer',
  failedDeliveries: 'Livraisons échouées',
  lowStock: 'Stock bas',
  pendingReviews: 'Avis à modérer',
  unreadMessages: 'Messages non lus',
  abandonedCarts: 'Paniers abandonnés',
};

export function DashboardPage() {
  const [period, setPeriod] = useState<Period>('30d');

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', period],
    queryFn: () => api<Summary>('/admin/dashboard/summary', { query: { period } }),
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tableau de bord</h1>
          <p className="text-sm text-muted">
            Chiffres arrêtés à la journée, fuseau Africa/Algiers.
          </p>
        </div>
        <div className="flex gap-1 rounded-sm border border-line p-1" role="group">
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={period === option.value}
              onClick={() => setPeriod(option.value)}
              className={cn(
                'rounded-xs px-3 py-1.5 text-xs font-medium transition-colors',
                period === option.value
                  ? 'bg-brass text-on-brass'
                  : 'text-muted hover:bg-elevated hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <Card>
          <CardBody className="text-sm text-danger">
            Impossible de charger les indicateurs. Vérifiez que l’API tourne.
          </CardBody>
        </Card>
      ) : null}

      <section aria-label="Indicateurs clés" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-28" />)
          : data?.tiles.map((tile) => <KpiCard key={tile.key} tile={tile} />)}
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Chiffre d’affaires et bénéfice net</CardTitle>
          </CardHeader>
          <CardBody>
            {isLoading ? (
              <Skeleton className="h-64" label="Chargement du graphique" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data?.series ?? []} margin={{ left: 8, right: 8 }}>
                  <defs>
                    <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(var(--jk-brass))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="rgb(var(--jk-brass))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgb(var(--jk-line))" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={shortDay}
                    stroke="rgb(var(--jk-muted))"
                    fontSize={11}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(value: number) => compactDzd(value)}
                    stroke="rgb(var(--jk-muted))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                  />
                  <Tooltip content={<MoneyTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="rgb(var(--jk-brass))"
                    strokeWidth={2}
                    fill="url(#revenue)"
                    name="Chiffre d’affaires"
                  />
                  <Area
                    type="monotone"
                    dataKey="netProfit"
                    stroke="rgb(var(--jk-success))"
                    strokeWidth={2}
                    fill="none"
                    name="Bénéfice net"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>À traiter</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {isLoading
              ? Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-9" />)
              : Object.entries(data?.attention ?? {}).map(([key, count]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-sm border border-line px-3 py-2 text-sm"
                  >
                    <span className="text-muted">{ATTENTION_LABELS[key] ?? key}</span>
                    <Badge tone={count > 0 ? 'warning' : 'neutral'}>{count}</Badge>
                  </div>
                ))}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Commandes par jour</CardTitle>
        </CardHeader>
        <CardBody>
          {isLoading ? (
            <Skeleton className="h-48" label="Chargement du graphique" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data?.series ?? []} margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="rgb(var(--jk-line))" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={shortDay}
                  stroke="rgb(var(--jk-muted))"
                  fontSize={11}
                  tickLine={false}
                />
                <YAxis stroke="rgb(var(--jk-muted))" fontSize={11} tickLine={false} axisLine={false} width={32} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="ordersCount"
                  stroke="rgb(var(--jk-spark))"
                  strokeWidth={2}
                  dot={false}
                  name="Commandes"
                />
                <Line
                  type="monotone"
                  dataKey="deliveredCount"
                  stroke="rgb(var(--jk-success))"
                  strokeWidth={2}
                  dot={false}
                  name="Livrées"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardBody>
      </Card>

      {/* The map, the heatmap and the funnel load on their own so the tiles above are
          never waiting on them. */}
      <InsightsPanel period={period} />
    </div>
  );
}

function KpiCard({ tile }: { tile: Tile }) {
  const isMoney = MONEY_TILES.has(tile.key);
  const isRate = tile.key === 'deliveryRate';
  const value = isMoney
    ? format(toMoney(tile.value), { compact: true })
    : isRate
      ? `${Number(tile.value)} %`
      : String(tile.value);

  const change = tile.changePercent;
  const Arrow = change === null ? Minus : change >= 0 ? ArrowUpRight : ArrowDownRight;
  // Spending more on ads is not an improvement, so that tile reads the other way.
  const improving = change === null ? null : tile.key === 'adSpend' ? change <= 0 : change >= 0;

  return (
    <Card>
      <CardBody className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wider text-muted">
          {TILE_LABELS[tile.key] ?? tile.key}
        </p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p
          className={cn(
            'flex items-center gap-1 text-xs',
            improving === null ? 'text-muted' : improving ? 'text-success' : 'text-danger',
          )}
        >
          <Arrow className="h-3 w-3" aria-hidden />
          {change === null ? 'Pas de comparaison' : `${Math.abs(change)} % vs période précédente`}
        </p>
      </CardBody>
    </Card>
  );
}

function MoneyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-line bg-surface p-3 text-xs shadow-lift">
      <p className="mb-1 font-medium">{label ? shortDay(label) : ''}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 tabular-nums" style={{ color: entry.color }}>
          <span className="text-muted">{entry.name}</span>
          <span>{format(money(BigInt(Math.round(entry.value ?? 0))))}</span>
        </p>
      ))}
    </div>
  );
}

function toMoney(value: string | number): Money {
  return money(BigInt(typeof value === 'string' ? value : Math.round(value)));
}

function compactDzd(value: number): string {
  return format(money(BigInt(Math.round(value))), { compact: true, withSymbol: false });
}

function shortDay(value: string): string {
  return new Date(value).toLocaleDateString('fr-DZ', { day: '2-digit', month: 'short' });
}
