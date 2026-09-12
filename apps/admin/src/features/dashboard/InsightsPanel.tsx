import { Badge, Card, CardBody, CardHeader, CardTitle, Skeleton, cn } from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { dateTimeFormatter, formatDa } from '@/lib/errors';
import { WilayaMap } from './WilayaMap';

/**
 * The second half of the dashboard — PRD F-AD-02 and F-AD-04.
 *
 * Three questions a weekly figure cannot answer: where the orders are, when they
 * arrive, and how many survive to a doorstep. Fetched separately from the KPI tiles so
 * the numbers at the top are never waiting on a heatmap.
 */

interface Insights {
  byWilaya: Array<{
    wilayaCode: number;
    wilayaName: string;
    orders: number;
    delivered: number;
    revenueMinor: string;
    successRate: number;
    latitude: number | null;
    longitude: number | null;
  }>;
  heatmap: Array<{ weekday: number; hour: number; orders: number }>;
  funnel: Array<{ key: string; label: string; count: number; ofPrevious: number }>;
  activity: Array<{
    id: string;
    action: string;
    entity: string;
    entityLabel: string | null;
    actorName: string;
    createdAt: string;
  }>;
  endingPromotions: Array<{
    id: string;
    name: string;
    code: string | null;
    endsAt: string;
    usageCount: number;
  }>;
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const ACTION_LABELS: Record<string, string> = {
  create: 'a créé',
  update: 'a modifié',
  delete: 'a supprimé',
  login: 's’est connecté',
  transition: 'a fait avancer',
};

export function InsightsPanel({ period }: { period: string }) {
  const insights = useQuery({
    queryKey: ['admin', 'dashboard-insights', period],
    queryFn: () => api<Insights>('/admin/dashboard/insights', { query: { period } }),
    staleTime: 60_000,
  });

  if (insights.isLoading) {
    return (
      <div className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-72" label="Chargement des analyses" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const data = insights.data;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quand les commandes arrivent</CardTitle>
          </CardHeader>
          <CardBody>
            <Heatmap cells={data.heatmap} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>De la vue à la porte</CardTitle>
          </CardHeader>
          <CardBody>
            <Funnel steps={data.funnel} />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px] xl:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Par wilaya</CardTitle>
          </CardHeader>
          {/* The map answers "where", the table answers "how much". Both, because a
              disc cannot be read to the dinar and a table cannot be read at a glance. */}
          <CardBody className="flex flex-col gap-4">
            <WilayaMap points={data.byWilaya} />
          </CardBody>
          <CardBody className="p-0">
            <WilayaTable rows={data.byWilaya} />
          </CardBody>
        </Card>

        <div className="flex flex-col gap-5">
          {data.endingPromotions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Promotions qui se terminent</CardTitle>
              </CardHeader>
              <CardBody className="p-0">
                <ul className="divide-y divide-line">
                  {data.endingPromotions.map((promotion) => (
                    <li key={promotion.id}>
                      <Link
                        to={`/promotions/${promotion.id}`}
                        className="flex items-center gap-2 px-4 py-2.5 hover:bg-elevated"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{promotion.name}</p>
                          <p className="truncate text-xs text-muted">
                            {promotion.usageCount} utilisation(s)
                          </p>
                        </div>
                        <Badge tone="warning">
                          {relativeDays(promotion.endsAt)}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Activité de l’équipe</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              {data.activity.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">Rien de récent.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.activity.map((entry) => (
                    <li key={entry.id} className="px-4 py-2">
                      <p className="text-sm">
                        <span className="font-medium">{entry.actorName}</span>{' '}
                        {ACTION_LABELS[entry.action] ?? entry.action}{' '}
                        <span className="text-muted">{entry.entity}</span>
                      </p>
                      <p className="text-xs text-muted">
                        {dateTimeFormatter.format(new Date(entry.createdAt))}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Orders by weekday and hour.
 *
 * Shaded against the busiest cell rather than an absolute scale: what matters is which
 * hour is the shop's own peak, not how it compares to somebody else's.
 */
function Heatmap({ cells }: { cells: Insights['heatmap'] }) {
  const busiest = cells.reduce((max, cell) => Math.max(max, cell.orders), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="w-8" />
            {Array.from({ length: 24 }, (_, hour) => (
              <th key={hour} className="text-[9px] font-normal text-muted">
                {hour % 3 === 0 ? hour : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((label, weekday) => (
            <tr key={label}>
              <th className="pe-1 text-end text-[10px] font-normal text-muted">{label}</th>
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = cells.find((entry) => entry.weekday === weekday && entry.hour === hour);
                const count = cell?.orders ?? 0;
                const intensity = busiest === 0 ? 0 : count / busiest;

                return (
                  <td key={hour} className="p-0">
                    <span
                      title={`${label} ${hour}h — ${count} commande(s)`}
                      className="block h-4 w-full rounded-[2px]"
                      style={{
                        background:
                          count === 0
                            ? 'var(--color-elevated)'
                            : `color-mix(in srgb, var(--color-brass) ${Math.round(
                                15 + intensity * 85,
                              )}%, transparent)`,
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">
        Heure d’Alger. La case la plus foncée est le pic de la boutique.
      </p>
    </div>
  );
}

function Funnel({ steps }: { steps: Insights['funnel'] }) {
  const top = steps[0]?.count ?? 0;

  return (
    <ul className="flex flex-col gap-2">
      {steps.map((step, index) => {
        const width = top === 0 ? 0 : Math.max(2, (step.count / top) * 100);

        return (
          <li key={step.key} className="flex items-center gap-3">
            <span className="w-36 shrink-0 text-sm">{step.label}</span>
            <span className="relative h-6 flex-1 overflow-hidden rounded-sm bg-elevated">
              <span
                className="absolute inset-y-0 start-0 rounded-sm bg-brass/70"
                style={{ width: `${width}%` }}
              />
            </span>
            <span className="w-20 shrink-0 text-end text-sm tabular-nums">
              {step.count.toLocaleString('fr-DZ')}
            </span>
            <span
              className={cn(
                'w-16 shrink-0 text-end text-xs tabular-nums',
                index > 0 && step.ofPrevious < 30 ? 'text-danger' : 'text-muted',
              )}
            >
              {index === 0 ? '' : `${step.ofPrevious} %`}
            </span>
          </li>
        );
      })}
      <li className="text-xs text-muted">
        L’entonnoir se termine à la livraison, pas à la commande : en paiement à la livraison,
        s’arrêter au checkout flatte le taux de conversion.
      </li>
    </ul>
  );
}

function WilayaTable({ rows }: { rows: Insights['byWilaya'] }) {
  const busiest = rows.reduce((max, row) => Math.max(max, row.orders), 0);

  if (rows.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted">Aucune commande sur la période.</p>;
  }

  return (
    <div className="max-h-96 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <th className="px-4 py-2 text-start font-medium">Wilaya</th>
            <th className="px-4 py-2 text-end font-medium">Commandes</th>
            <th className="px-4 py-2 text-end font-medium">Livrées</th>
            <th className="px-4 py-2 text-end font-medium">Réussite</th>
            <th className="px-4 py-2 text-end font-medium">CA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.wilayaCode}>
              <td className="px-4 py-2">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: `color-mix(in srgb, var(--color-brass) ${Math.round(
                        20 + (busiest === 0 ? 0 : row.orders / busiest) * 80,
                      )}%, transparent)`,
                    }}
                  />
                  <span className="font-medium">{String(row.wilayaCode).padStart(2, '0')}</span>
                  <span className="text-muted">{row.wilayaName}</span>
                </span>
              </td>
              <td className="px-4 py-2 text-end tabular-nums">{row.orders}</td>
              <td className="px-4 py-2 text-end tabular-nums text-success">{row.delivered}</td>
              <td
                className={cn(
                  'px-4 py-2 text-end tabular-nums',
                  row.successRate < 60 && 'text-danger',
                )}
              >
                {row.successRate} %
              </td>
              <td className="px-4 py-2 text-end tabular-nums">{formatDa(row.revenueMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "dans 3 j", the way somebody would actually say it. */
function relativeDays(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'demain';
  return `dans ${days} j`;
}
