import type { ReportColumn, ReportKey, ReportResult } from '@jecks/shared';
import {
  Alert,
  Button,
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
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, FileBarChart } from 'lucide-react';
import { useState } from 'react';
import { download } from '@/lib/api';
import { formatDa, message } from '@/lib/errors';
import * as finance from './api';

/**
 * The report library — PRD F-AD-80/81.
 *
 * A list of named reports rather than a query builder: every report is a question
 * somebody actually asks, and the answer comes back with its own columns so a new
 * report needs no change here.
 */
export function ReportsPage() {
  const [selected, setSelected] = useState<ReportKey>('sales.by_product');
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 29);
    return date.toISOString().slice(0, 10);
  });

  const catalogue = useQuery({
    queryKey: ['admin', 'report-catalogue'],
    queryFn: finance.reportCatalogue,
    staleTime: Infinity,
  });

  const report = useQuery({
    queryKey: ['admin', 'report', selected, from, to],
    queryFn: () => finance.runReport(selected, { from, to, limit: 100 }),
  });

  const groups = new Map<string, Array<{ key: ReportKey; title: string }>>();
  for (const entry of catalogue.data ?? []) {
    const list = groups.get(entry.group) ?? [];
    list.push({ key: entry.key, title: entry.title });
    groups.set(entry.group, list);
  }

  async function exportReport(format: 'csv' | 'xlsx') {
    try {
      await download(`/admin/reports/${selected}`, { query: { from, to, limit: 500, format } });
      notify.success(`Export ${format.toUpperCase()} téléchargé`);
    } catch (error) {
      notify.error(message(error, "L'export a échoué"));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Rapports"
        description="Les questions qu’on pose vraiment, avec leurs réponses."
        actions={
          <>
            <Field label="Du" className="w-[150px]">
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="Au" className="w-[150px]">
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
            <Button variant="outline" size="sm" onClick={() => void exportReport('xlsx')}>
              <Download className="h-4 w-4" />
              Exporter
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[260px_1fr] lg:items-start">
        <nav aria-label="Rapports" className="flex flex-col gap-4">
          {[...groups.entries()].map(([group, entries]) => (
            <div key={group}>
              <p className="px-2 text-xs uppercase tracking-wider text-muted">{group}</p>
              <ul className="mt-1 flex flex-col">
                {entries.map((entry) => (
                  <li key={entry.key}>
                    <button
                      type="button"
                      aria-current={entry.key === selected}
                      onClick={() => setSelected(entry.key)}
                      className={cn(
                        'w-full rounded-sm px-2 py-1.5 text-start text-sm transition-colors',
                        entry.key === selected
                          ? 'bg-brass/15 font-medium text-brass'
                          : 'text-muted hover:bg-elevated hover:text-ink',
                      )}
                    >
                      {entry.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          {report.isLoading ? (
            <Skeleton className="h-96" label="Exécution du rapport" />
          ) : report.error ? (
            <EmptyState
              title="Le rapport n’a pas pu être exécuté"
              description={(report.error as Error).message}
              action={
                <Button size="sm" variant="outline" onClick={() => void report.refetch()}>
                  Réessayer
                </Button>
              }
            />
          ) : report.data ? (
            <ReportView result={report.data} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ReportView({ result }: { result: ReportResult }) {
  if (result.rows.length === 0) {
    return (
      <EmptyState
        icon={<FileBarChart className="h-6 w-6" />}
        title={result.title}
        description="Aucune donnée sur cette période."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {result.series && result.series.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{result.title}</CardTitle>
          </CardHeader>
          <CardBody className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.series.slice(0, 15)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={70}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-line)',
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" fill="var(--color-brass)" radius={2} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{result.title}</CardTitle>
          <span className="text-xs text-muted">
            {result.from} → {result.to}
          </span>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                {result.columns.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      'px-4 py-2 font-medium',
                      column.type === 'text' || column.type === 'date'
                        ? 'text-start'
                        : 'text-end',
                    )}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.rows.map((row, index) => (
                <tr key={index} className="hover:bg-elevated/50">
                  {result.columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-4 py-2',
                        column.type === 'text' || column.type === 'date'
                          ? 'text-start'
                          : 'text-end tabular-nums',
                      )}
                    >
                      {render(row[column.key], column)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {result.truncated ? (
        <Alert tone="warning" title="Résultat tronqué">
          Seules les premières lignes sont affichées. L’export contient davantage.
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * Renders a cell from the type the report declared.
 *
 * The report says what its columns mean, so this file never has to know that
 * "lostRevenue" is money and "requests" is not.
 */
function render(value: string | number | null | undefined, column: ReportColumn): string {
  if (value === null || value === undefined || value === '') return '—';

  if (column.type === 'money') {
    // Reports send major units; the formatter takes centimes.
    return formatDa(String(Math.round(Number(value) * 100)));
  }
  if (column.type === 'percent') return `${value} %`;
  if (column.type === 'number') return Number(value).toLocaleString('fr-DZ');

  return String(value);
}
