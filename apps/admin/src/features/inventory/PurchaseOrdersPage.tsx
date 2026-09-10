import { PurchaseOrderStatus, type PurchaseOrderRow } from '@jecks/shared';
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
import { Download, Plus, Search, X } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { dateFormatter, formatDa, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import { useLocations, usePurchaseOrderCounts, useSupplierOptions } from './queries';

/** Purchase orders — PRD F-AD-52. */

const STATUS_TABS = [
  { value: 'ALL', label: 'Toutes' },
  { value: PurchaseOrderStatus.DRAFT, label: 'Brouillons' },
  { value: PurchaseOrderStatus.ORDERED, label: 'Commandées' },
  { value: PurchaseOrderStatus.PARTIALLY_RECEIVED, label: 'Partielles' },
  { value: PurchaseOrderStatus.RECEIVED, label: 'Reçues' },
  { value: PurchaseOrderStatus.CANCELLED, label: 'Annulées' },
];

export const PO_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  ORDERED: 'Commandée',
  PARTIALLY_RECEIVED: 'Partiellement reçue',
  RECEIVED: 'Reçue',
  CANCELLED: 'Annulée',
};

export const PO_STATUS_TONES: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> =
  {
    DRAFT: 'neutral',
    ORDERED: 'info',
    PARTIALLY_RECEIVED: 'warning',
    RECEIVED: 'success',
    CANCELLED: 'danger',
  };

export function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const suppliers = useSupplierOptions();
  const locations = useLocations();
  const counts = usePurchaseOrderCounts();

  const table = useServerTable<PurchaseOrderRow>({
    module: 'purchase-orders',
    endpoint: '/admin/purchase-orders',
    defaultSort: 'createdAt',
    filterKeys: ['status', 'supplierId', 'locationId'],
  });

  const activeStatus = table.filters.status ?? [];

  const columns = useMemo<ColumnDef<PurchaseOrderRow, unknown>[]>(
    () => [
      {
        id: 'number',
        header: 'Numéro',
        accessorKey: 'number',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-medium text-ink">{row.original.number}</p>
            <p className="truncate text-xs text-muted">{row.original.supplierName}</p>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Statut',
        accessorKey: 'status',
        cell: ({ row }) => (
          <Badge tone={PO_STATUS_TONES[row.original.status] ?? 'neutral'}>
            {PO_STATUS_LABELS[row.original.status] ?? row.original.status}
          </Badge>
        ),
      },
      {
        id: 'location',
        header: 'Réception',
        enableSorting: false,
        cell: ({ row }) => <span className="text-sm">{row.original.locationName}</span>,
      },
      {
        id: 'progress',
        header: 'Reçu',
        enableSorting: false,
        cell: ({ row }) => {
          const ratio =
            row.original.quantityOrdered === 0
              ? 0
              : row.original.quantityReceived / row.original.quantityOrdered;
          return (
            <div className="min-w-[110px]">
              <p className="text-sm tabular-nums">
                {row.original.quantityReceived} / {row.original.quantityOrdered}
              </p>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-elevated">
                <div
                  className={cn('h-full', ratio >= 1 ? 'bg-success' : 'bg-brass')}
                  style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                />
              </div>
            </div>
          );
        },
      },
      {
        id: 'total',
        header: 'Total',
        accessorKey: 'total',
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">{formatDa(row.original.total)}</span>
        ),
      },
      {
        id: 'expectedAt',
        header: 'Attendu',
        accessorKey: 'expectedAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {row.original.expectedAt
              ? dateFormatter.format(new Date(row.original.expectedAt))
              : '—'}
          </span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Créée',
        accessorKey: 'createdAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {dateFormatter.format(new Date(row.original.createdAt))}
          </span>
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
        title="Commandes fournisseur"
        description="Ce que vous avez commandé, ce qui est arrivé, et ce que ça a coûté."
        actions={
          <>
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
            <Button size="sm" onClick={() => navigate('/inventory/purchase-orders/new')}>
              <Plus className="h-4 w-4" />
              Nouvelle commande
            </Button>
          </>
        }
      />

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max items-center gap-1 border-b border-line">
          {STATUS_TABS.map((tab) => {
            const selected =
              tab.value === 'ALL' ? activeStatus.length === 0 : activeStatus.includes(tab.value);
            return (
              <button
                key={tab.value}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  tab.value === 'ALL'
                    ? table.setFilter('status', [])
                    : table.setFilter('status', selected ? [] : [tab.value])
                }
                className={cn(
                  'relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm transition-colors',
                  selected
                    ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brass'
                    : 'text-muted hover:text-ink',
                )}
              >
                {tab.label}
                <span className="text-xs tabular-nums opacity-70">
                  {counts.data?.[tab.value] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <DataTable<PurchaseOrderRow>
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
        onRowClick={(row) => navigate(`/inventory/purchase-orders/${row.id}`)}
        emptyTitle="Aucune commande fournisseur"
        emptyDescription="Créez une commande pour réapprovisionner votre stock."
        emptyAction={
          <Button size="sm" onClick={() => navigate('/inventory/purchase-orders/new')}>
            <Plus className="h-4 w-4" />
            Nouvelle commande
          </Button>
        }
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <label className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={table.search}
                onChange={(event) => table.setSearch(event.target.value)}
                placeholder="Numéro ou fournisseur"
                className="ps-9"
                aria-label="Rechercher une commande fournisseur"
              />
            </label>
            <MultiSelect
              options={(suppliers.data ?? []).map((supplier) => ({
                value: supplier.id,
                label: supplier.name,
              }))}
              values={table.filters.supplierId ?? []}
              onValuesChange={(values) => table.setFilter('supplierId', values)}
              placeholder="Fournisseur"
            />
            <MultiSelect
              options={(locations.data ?? []).map((location) => ({
                value: location.id,
                label: location.name,
              }))}
              values={table.filters.locationId ?? []}
              onValuesChange={(values) => table.setFilter('locationId', values)}
              placeholder="Emplacement"
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
