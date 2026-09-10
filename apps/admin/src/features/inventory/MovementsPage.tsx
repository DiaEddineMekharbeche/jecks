import { StockMovementReason, t, type StockMovementRow } from '@jecks/shared';
import {
  Badge,
  Button,
  DataTable,
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
import { useMemo } from 'react';
import { dateTimeFormatter, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import { useLocations } from './queries';

/**
 * The stock movement ledger — PRD F-AD-51.
 *
 * Append-only and read-only: this screen has no edit action by design. A wrong movement
 * is corrected by posting another one, which is what keeps the balance column a running
 * total anyone can check rather than a number that was quietly rewritten.
 */

const REASON_LABELS: Record<string, string> = {
  [StockMovementReason.PURCHASE]: 'Réception',
  [StockMovementReason.SALE]: 'Vente',
  [StockMovementReason.RETURN]: 'Retour',
  [StockMovementReason.ADJUSTMENT]: 'Correction',
  [StockMovementReason.TRANSFER]: 'Transfert',
  [StockMovementReason.DAMAGED]: 'Casse',
  [StockMovementReason.STOCK_COUNT]: 'Inventaire',
  [StockMovementReason.RESERVATION]: 'Réservation',
  [StockMovementReason.RELEASE]: 'Libération',
};

const REASON_TONES: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  [StockMovementReason.PURCHASE]: 'success',
  [StockMovementReason.SALE]: 'info',
  [StockMovementReason.RETURN]: 'info',
  [StockMovementReason.ADJUSTMENT]: 'warning',
  [StockMovementReason.TRANSFER]: 'neutral',
  [StockMovementReason.DAMAGED]: 'danger',
  [StockMovementReason.STOCK_COUNT]: 'warning',
};

export function MovementsPage() {
  const locations = useLocations();

  const table = useServerTable<StockMovementRow>({
    module: 'stock-movements',
    endpoint: '/admin/inventory/movements',
    defaultSort: 'createdAt',
    filterKeys: ['locationId', 'reason', 'variantId'],
  });

  const columns = useMemo<ColumnDef<StockMovementRow, unknown>[]>(
    () => [
      {
        id: 'createdAt',
        header: 'Date',
        accessorKey: 'createdAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {dateTimeFormatter.format(new Date(row.original.createdAt))}
          </span>
        ),
      },
      {
        id: 'sku',
        header: 'Article',
        accessorKey: 'sku',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{t(row.original.productName, 'fr')}</p>
            <p className="truncate text-xs text-muted">
              {row.original.sku}
              {row.original.variantName ? ` · ${row.original.variantName}` : ''}
            </p>
          </div>
        ),
      },
      {
        id: 'location',
        header: 'Emplacement',
        enableSorting: false,
        cell: ({ row }) => <span className="text-sm">{row.original.locationName}</span>,
      },
      {
        id: 'quantity',
        header: 'Quantité',
        accessorKey: 'quantity',
        cell: ({ row }) => (
          <span
            className={cn(
              'font-medium tabular-nums',
              row.original.quantity > 0
                ? 'text-success'
                : row.original.quantity < 0
                  ? 'text-danger'
                  : 'text-muted',
            )}
          >
            {row.original.quantity > 0 ? `+${row.original.quantity}` : row.original.quantity}
          </span>
        ),
      },
      {
        id: 'balanceAfter',
        header: 'Solde',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted">{row.original.balanceAfter}</span>
        ),
      },
      {
        id: 'reason',
        header: 'Motif',
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone={REASON_TONES[row.original.reason] ?? 'neutral'}>
            {REASON_LABELS[row.original.reason] ?? row.original.reason}
          </Badge>
        ),
      },
      {
        id: 'note',
        header: 'Détail',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0 max-w-[280px]">
            <p className="truncate text-sm">{row.original.note ?? '—'}</p>
            {row.original.referenceType ? (
              <p className="truncate text-xs text-muted">{row.original.referenceType}</p>
            ) : null}
          </div>
        ),
      },
      {
        id: 'actor',
        header: 'Par',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted">{row.original.actorName ?? 'Système'}</span>
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
        title="Mouvements de stock"
        description="Le grand livre du stock : chaque entrée et sortie, avec son motif et son solde."
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

      <DataTable<StockMovementRow>
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
        emptyTitle="Aucun mouvement"
        emptyDescription="Les réceptions, ventes et corrections apparaîtront ici."
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={table.search}
                onChange={(event) => table.setSearch(event.target.value)}
                placeholder="SKU ou note"
                className="ps-9"
                aria-label="Rechercher un mouvement"
              />
            </label>

            <MultiSelect
              options={(locations.data ?? []).map((location) => ({
                value: location.id,
                label: location.name,
              }))}
              values={table.filters.locationId ?? []}
              onValuesChange={(values) => table.setFilter('locationId', values)}
              placeholder="Emplacement"
            />
            <MultiSelect
              options={Object.entries(REASON_LABELS).map(([value, label]) => ({ value, label }))}
              values={table.filters.reason ?? []}
              onValuesChange={(values) => table.setFilter('reason', values)}
              placeholder="Motif"
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
    </div>
  );
}
