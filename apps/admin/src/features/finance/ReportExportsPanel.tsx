import type { ReportKey } from '@jecks/shared';
import { Alert, Badge, Button, Card, CardBody, Skeleton, notify } from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { Clock, Download, FileDown } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/features/auth/session';
import { dateTimeFormatter, message } from '@/lib/errors';
import * as finance from './api';

/**
 * Exports nobody waits for — PRD Section 5.9.
 *
 * The Exporter button downloads what is on screen, capped at what a browser can hold a
 * connection open for. This is the other case: a year of order lines for the accountant,
 * which takes a minute to assemble and arrives as a link.
 *
 * Only shown to somebody with `reports.export`, because a full export is a copy of the
 * shop's numbers leaving it.
 */
export function ReportExportsPanel({
  selected,
  from,
  to,
}: {
  selected: ReportKey;
  from: string;
  to: string;
}) {
  const canExport = useSession((state) => state.can)('reports.export');
  const [busy, setBusy] = useState(false);

  const exports = useQuery({
    queryKey: ['admin', 'report-exports'],
    queryFn: finance.listReportExports,
    enabled: canExport,
    // Poll while something is moving, then stop: this screen is otherwise static.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((row) => row.status === 'queued' || row.status === 'running')
        ? 4_000
        : false,
  });

  if (!canExport) return null;

  async function queue(format: 'csv' | 'xlsx') {
    setBusy(true);
    try {
      await finance.queueReportExport(selected, { from, to, format });
      notify.success('Export lancé ; le fichier apparaîtra ici une fois prêt');
      void exports.refetch();
    } catch (error) {
      notify.error(message(error, "L'export n'a pas pu être lancé"));
    } finally {
      setBusy(false);
    }
  }

  const rows = exports.data ?? [];

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink">Export complet</p>
            <p className="text-xs text-muted">
              Sans limite de lignes, préparé en arrière-plan. Pour une période longue.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" loading={busy} onClick={() => void queue('xlsx')}>
              <FileDown className="h-4 w-4" />
              Excel
            </Button>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void queue('csv')}>
              CSV
            </Button>
          </div>
        </div>

        {exports.isLoading ? (
          <Skeleton className="h-16 w-full" label="Chargement" />
        ) : rows.length === 0 ? null : (
          <div className="flex flex-col gap-1.5">
            {rows.slice(0, 6).map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                    {row.title || row.key}
                    <StatusBadge status={row.status} />
                    <span className="text-xs text-muted">
                      {row.from} → {row.to} · {row.format.toUpperCase()}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted">
                    {row.status === 'ready'
                      ? `${(row.rows ?? 0).toLocaleString('fr-DZ')} lignes · ${dateTimeFormatter.format(new Date(row.createdAt))}`
                      : (row.error ?? 'En préparation…')}
                  </p>
                </div>

                {row.downloadUrl ? (
                  <a
                    href={row.downloadUrl}
                    download
                    className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-3 text-xs text-ink transition-colors hover:border-brass hover:text-brass"
                  >
                    <Download className="h-4 w-4" />
                    Télécharger
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {rows.some((row) => row.status === 'failed' && /injoignable/i.test(row.error ?? '')) ? (
          <Alert tone="warning" title="La file d’attente était injoignable">
            Le worker ou Redis ne tournait pas au moment de la demande. Relancez l’export une
            fois les services revenus.
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}

function StatusBadge({ status }: { status: finance.ReportExportRow['status'] }) {
  if (status === 'ready') return <Badge tone="success">Prêt</Badge>;
  if (status === 'failed') return <Badge tone="danger">Échoué</Badge>;
  return (
    <Badge tone="warning">
      <Clock className="h-3 w-3" />
      {status === 'running' ? 'En cours' : 'En file'}
    </Badge>
  );
}
