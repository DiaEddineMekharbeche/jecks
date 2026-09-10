import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  cn,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useState } from 'react';
import { formatDa } from '@/lib/errors';
import * as delivery from './api';
import { FAILURE_LABELS } from './labels';

/**
 * Delivery analytics — PRD F-AD-65.
 *
 * The number a cash-on-delivery shop lives by is the share of parcels that actually
 * reach a door. It is never one number: a courier who is excellent in Alger can be
 * hopeless in the south, so everything here is broken down before it is averaged.
 *
 * The rate counts finished parcels only. Including ones still in transit would make a
 * busy week look like a bad one.
 */
export function DeliveryAnalyticsPage() {
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 29);
    return date.toISOString().slice(0, 10);
  });

  const analytics = useQuery({
    queryKey: ['admin', 'delivery-analytics', from, to],
    queryFn: () => delivery.deliveryAnalytics({ from, to }),
  });

  const data = analytics.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Analyse des livraisons"
        description="Qui livre vraiment, où, et en combien de temps."
        actions={
          <div className="flex items-end gap-2">
            <Field label="Du" className="w-[150px]">
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="Au" className="w-[150px]">
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>
        }
      />

      {analytics.isLoading ? (
        <Skeleton className="h-96" label="Chargement de l’analyse" />
      ) : !data || data.shipped === 0 ? (
        <EmptyState
          title="Aucune expédition sur la période"
          description="Choisissez une autre plage de dates."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Tile label="Expédiées" value={String(data.shipped)} />
            <Tile
              label="Taux de réussite"
              value={`${data.successRate} %`}
              hint="sur les colis clôturés"
              tone={data.successRate >= 80 ? 'success' : data.successRate < 65 ? 'danger' : undefined}
            />
            <Tile
              label="Délai moyen"
              value={data.averageHours >= 24
                ? `${(data.averageHours / 24).toFixed(1)} j`
                : `${data.averageHours} h`}
              hint="remise → porte"
            />
            <Tile label="Coût transport" value={formatDa(data.shippingCostMinor)} />
            <Tile
              label="Marge livraison"
              value={formatDa(
                (BigInt(data.shippingRevenueMinor) - BigInt(data.shippingCostMinor)).toString(),
              )}
              tone={
                BigInt(data.shippingRevenueMinor) < BigInt(data.shippingCostMinor)
                  ? 'danger'
                  : undefined
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Jour par jour</CardTitle>
            </CardHeader>
            <CardBody className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value: string) => value.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-line)',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="shipped"
                    name="Expédiées"
                    stroke="var(--color-brass)"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="delivered"
                    name="Livrées"
                    stroke="var(--color-success)"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="failed"
                    name="Échecs"
                    stroke="var(--color-danger)"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Par transporteur</CardTitle>
              </CardHeader>
              <CardBody className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                      <th className="px-4 py-2 text-start font-medium">Transporteur</th>
                      <th className="px-4 py-2 text-end font-medium">Colis</th>
                      <th className="px-4 py-2 text-end font-medium">Réussite</th>
                      <th className="px-4 py-2 text-end font-medium">Délai</th>
                      <th className="px-4 py-2 text-end font-medium">Coût</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.byCourier.map((row) => (
                      <tr key={row.courierId ?? 'fleet'}>
                        <td className="px-4 py-2">{row.courierName}</td>
                        <td className="px-4 py-2 text-end tabular-nums">{row.shipped}</td>
                        <td
                          className={cn(
                            'px-4 py-2 text-end tabular-nums',
                            row.successRate >= 80 && 'text-success',
                            row.successRate < 65 && 'text-danger',
                          )}
                        >
                          {row.successRate} %
                        </td>
                        <td className="px-4 py-2 text-end tabular-nums text-muted">
                          {row.averageHours >= 24
                            ? `${(row.averageHours / 24).toFixed(1)} j`
                            : `${row.averageHours} h`}
                        </td>
                        <td className="px-4 py-2 text-end tabular-nums">
                          {formatDa(row.costMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Motifs d’échec</CardTitle>
              </CardHeader>
              <CardBody className="h-64">
                {data.byFailureReason.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-sm text-muted">
                    Aucun échec sur la période.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.byFailureReason.map((row) => ({
                        reason: FAILURE_LABELS[row.reason] ?? row.reason,
                        count: row.count,
                      }))}
                      layout="vertical"
                      margin={{ left: 40 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="reason"
                        tick={{ fontSize: 11 }}
                        width={110}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-line)',
                          borderRadius: 4,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="count" name="Colis" fill="var(--color-danger)" radius={2} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Par wilaya</CardTitle>
            </CardHeader>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-2 text-start font-medium">Wilaya</th>
                    <th className="px-4 py-2 text-end font-medium">Colis</th>
                    <th className="px-4 py-2 text-end font-medium">Livrés</th>
                    <th className="px-4 py-2 text-end font-medium">Échecs</th>
                    <th className="px-4 py-2 text-end font-medium">Réussite</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.byWilaya.map((row) => (
                    <tr key={row.wilayaCode}>
                      <td className="px-4 py-2">
                        <span className="font-medium">
                          {String(row.wilayaCode).padStart(2, '0')}
                        </span>
                        <span className="ms-2 text-muted">{row.wilayaName}</span>
                      </td>
                      <td className="px-4 py-2 text-end tabular-nums">{row.shipped}</td>
                      <td className="px-4 py-2 text-end tabular-nums text-success">
                        {row.delivered}
                      </td>
                      <td className="px-4 py-2 text-end tabular-nums text-danger">{row.failed}</td>
                      <td
                        className={cn(
                          'px-4 py-2 text-end tabular-nums',
                          row.successRate < 65 && 'text-danger',
                        )}
                      >
                        {row.successRate} %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </>
      )}
    </div>
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
