import type { AuditRow } from '@jecks/shared';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
  MultiSelect,
  PageHeader,
  TablePagination,
  cn,
  notify,
} from '@jecks/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { dateTimeFormatter, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import { useAuditEntityTypes } from '@/features/settings/queries';

/**
 * The journal — PRD F-AD-93.
 *
 * Every mutating admin request writes a row here through a global interceptor, so this
 * screen answers "who changed that price" without anyone having remembered to log it.
 * The diff view is the point: an entry naming a field without its before and after is
 * a note, not an audit.
 */

const ACTION_LABELS: Record<string, string> = {
  create: 'Création',
  update: 'Modification',
  delete: 'Suppression',
};

const ACTION_TONES: Record<string, 'success' | 'info' | 'danger' | 'neutral'> = {
  create: 'success',
  update: 'info',
  delete: 'danger',
};

const ENTITY_LABELS: Record<string, string> = {
  product: 'Produit',
  category: 'Catégorie',
  collection: 'Collection',
  inventory: 'Stock',
  location: 'Emplacement',
  supplier: 'Fournisseur',
  purchase_order: 'Commande fournisseur',
  stock_count: 'Inventaire',
  setting: 'Réglage',
  user: 'Utilisateur',
  role: 'Rôle',
  backup: 'Sauvegarde',
  media: 'Média',
  order: 'Commande',
};

export function AuditPage() {
  const entityTypes = useAuditEntityTypes();
  const [inspecting, setInspecting] = useState<AuditRow | null>(null);

  const table = useServerTable<AuditRow>({
    module: 'audit',
    endpoint: '/admin/audit',
    defaultSort: 'createdAt',
    filterKeys: ['entityType', 'action', 'actorId'],
  });

  const columns = useMemo<ColumnDef<AuditRow, unknown>[]>(
    () => [
      {
        id: 'createdAt',
        header: 'Quand',
        accessorKey: 'createdAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {dateTimeFormatter.format(new Date(row.original.createdAt))}
          </span>
        ),
      },
      {
        id: 'actor',
        header: 'Qui',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.actorLabel ?? 'Système'}</span>
        ),
      },
      {
        id: 'action',
        header: 'Quoi',
        accessorKey: 'action',
        cell: ({ row }) => (
          <Badge tone={ACTION_TONES[row.original.action] ?? 'neutral'}>
            {ACTION_LABELS[row.original.action] ?? row.original.action}
          </Badge>
        ),
      },
      {
        id: 'entityType',
        header: 'Sur',
        accessorKey: 'entityType',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm">
              {ENTITY_LABELS[row.original.entityType] ?? row.original.entityType}
            </p>
            <p className="truncate font-mono text-[11px] text-muted">
              {row.original.entityId ?? '—'}
            </p>
          </div>
        ),
      },
      {
        id: 'changes',
        header: 'Champs',
        enableSorting: false,
        cell: ({ row }) => {
          const fields = row.original.changes ? Object.keys(row.original.changes) : [];
          if (fields.length === 0) return <span className="text-xs text-muted">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {fields.slice(0, 3).map((field) => (
                <span
                  key={field}
                  className="rounded-xs bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-muted"
                >
                  {field}
                </span>
              ))}
              {fields.length > 3 ? (
                <span className="text-[11px] text-muted">+{fields.length - 3}</span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'ip',
        header: 'Depuis',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-muted">{row.original.ip ?? '—'}</span>
        ),
      },
    ],
    [],
  );

  async function handleExport(fileFormat: 'csv' | 'xlsx') {
    try {
      await table.exportRows(fileFormat);
      notify.success(`Export ${fileFormat.toUpperCase()} téléchargé`);
    } catch (error) {
      notify.error(message(error, "L'export a échoué"));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Journal"
        description="Chaque modification faite depuis l’administration, avec son auteur et son détail."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                Exporter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Format</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void handleExport('csv')}>CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleExport('xlsx')}>Excel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <DataTable<AuditRow>
        columns={columns}
        data={table.rows}
        getRowId={(row) => row.id}
        loading={table.loading}
        error={table.error?.message}
        onRetry={table.refetch}
        sorting={table.sorting}
        onSortingChange={table.setSorting}
        columnVisibility={table.columnVisibility}
        onColumnVisibilityChange={table.setColumnVisibility}
        density={table.density}
        onDensityChange={table.setDensity}
        onRowClick={(row) => setInspecting(row)}
        emptyTitle="Journal vide"
        emptyDescription="Les modifications faites depuis l’administration apparaîtront ici."
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={table.search}
                onChange={(event) => table.setSearch(event.target.value)}
                placeholder="Auteur, entité ou identifiant"
                className="ps-9"
                aria-label="Rechercher dans le journal"
              />
            </label>

            <MultiSelect
              options={(entityTypes.data ?? []).map((type) => ({
                value: type,
                label: ENTITY_LABELS[type] ?? type,
              }))}
              values={table.filters.entityType ?? []}
              onValuesChange={(values) => table.setFilter('entityType', values)}
              placeholder="Type"
            />
            <MultiSelect
              options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
              values={table.filters.action ?? []}
              onValuesChange={(values) => table.setFilter('action', values)}
              placeholder="Action"
            />

            {table.activeFilterCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={table.clearFilters}>
                <X className="h-4 w-4" />
                Effacer
              </Button>
            ) : null}
          </div>
        }
      />

      <TablePagination
        page={table.page}
        pageSize={table.pageSize}
        total={table.total}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        loading={table.fetching}
      />

      <DiffDialog row={inspecting} onClose={() => setInspecting(null)} />
    </div>
  );
}

function DiffDialog({ row, onClose }: { row: AuditRow | null; onClose: () => void }) {
  const entries = row?.changes ? Object.entries(row.changes) : [];

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {row ? `${ACTION_LABELS[row.action] ?? row.action} — ${ENTITY_LABELS[row.entityType] ?? row.entityType}` : ''}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {row ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Auteur</dt>
              <dd>{row.actorLabel ?? 'Système'}</dd>
              <dt className="text-muted">Quand</dt>
              <dd>{dateTimeFormatter.format(new Date(row.createdAt))}</dd>
              <dt className="text-muted">Identifiant</dt>
              <dd className="break-all font-mono text-xs">{row.entityId ?? '—'}</dd>
              <dt className="text-muted">Adresse IP</dt>
              <dd className="font-mono text-xs">{row.ip ?? '—'}</dd>
            </dl>
          ) : null}

          {entries.length === 0 ? (
            <p className="text-sm text-muted">Aucun détail de champ enregistré pour cette entrée.</p>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                    <th className="px-3 py-2 text-start font-medium">Champ</th>
                    <th className="px-3 py-2 text-start font-medium">Avant</th>
                    <th className="px-3 py-2 text-start font-medium">Après</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([field, change]) => (
                    <tr key={field} className="border-b border-line/60 last:border-0 align-top">
                      <td className="px-3 py-2 font-mono text-xs">{field}</td>
                      <td className={cn('px-3 py-2 text-xs', 'text-danger')}>
                        <Value value={change.before} />
                      </td>
                      <td className={cn('px-3 py-2 text-xs', 'text-success')}>
                        <Value value={change.after} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function Value({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <span className="text-muted">—</span>;
  if (typeof value === 'object') {
    return (
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span className="break-all">{String(value)}</span>;
}
