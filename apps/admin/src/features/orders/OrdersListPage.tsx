import { format, money, type OrderStatus } from '@jecks/shared';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Field,
  Input,
  PageHeader,
  StatusBadge,
  SwitchField,
  TablePagination,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { BookmarkPlus, Download, Printer, Search, Star, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useSavedViews, useServerTable } from '@/lib/server-table';
import { message } from '@/lib/errors';
import * as ordersApi from './api';

/**
 * Orders list — PRD F-AD-30.
 *
 * Everything on this screen comes from `/admin/orders`: the rows, the tab counters and
 * the export. Nothing is computed in the browser beyond formatting.
 */

interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  paymentStatus: string;
  paymentMethod: string;
  source: string;
  customerName: string;
  customerPhone: string;
  wilayaCode: number;
  wilayaName: string;
  communeName: string | null;
  deliveryType: string;
  itemCount: number;
  total: string;
  cogsTotal: string;
  shippingTotal: string;
  discountTotal: string;
  riskScore: number;
  agentName: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: 'Toutes' },
  { value: 'PENDING', label: 'À confirmer' },
  { value: 'CONFIRMED', label: 'Confirmées' },
  { value: 'PACKED', label: 'Préparées' },
  { value: 'SHIPPED', label: 'Expédiées' },
  { value: 'OUT_FOR_DELIVERY', label: 'En livraison' },
  { value: 'DELIVERED', label: 'Livrées' },
  { value: 'FAILED', label: 'Échouées' },
  { value: 'RETURNED', label: 'Retournées' },
  { value: 'CANCELLED', label: 'Annulées' },
  { value: 'REFUNDED', label: 'Remboursées' },
];

const dateFormatter = new Intl.DateTimeFormat('fr-DZ', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * What the selection bar offers. Each one is a real transition, so an order the state
 * machine refuses is reported by name rather than silently skipped.
 */
const BULK_ACTIONS = [
  { value: 'confirm' as const, label: 'Confirmer' },
  { value: 'pack' as const, label: 'Marquer préparées' },
  { value: 'ship' as const, label: 'Marquer expédiées' },
];

export function OrdersListPage() {
  const navigate = useNavigate();

  const table = useServerTable<OrderRow>({
    module: 'orders',
    endpoint: '/admin/orders',
    defaultSort: 'createdAt',
    filterKeys: ['status', 'paymentStatus', 'wilayaCode', 'source', 'paymentMethod', 'from', 'to'],
    defaultHiddenColumns: ['source', 'agentName', 'cogsTotal'],
  });

  const views = useSavedViews('orders');
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewShared, setViewShared] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);

  /**
   * Prints the selection, one order per page.
   *
   * This is the morning routine: confirm what came in overnight, print the invoices and
   * the packing slips, hand the stack to whoever fills the boxes.
   */
  async function printBatch(kind: 'invoice' | 'packing-slip', ids: string[]) {
    setPrinting(kind);
    try {
      await ordersApi.downloadOrderDocuments(ids, kind);
    } catch (error) {
      notify.error(message(error, "L'impression a échoué"));
    } finally {
      setPrinting(null);
    }
  }

  /**
   * Applies one action to the selection.
   *
   * Refusals are listed rather than swallowed: an agent confirming forty orders needs
   * to know which two were already cancelled, and losing the other thirty-eight to a
   * single failure would be worse than either.
   */
  async function runBulk(
    action: (typeof BULK_ACTIONS)[number]['value'],
    ids: string[],
    clear: () => void,
  ) {
    setBulkBusy(action);
    try {
      const result = await ordersApi.bulkOrders({ ids, action });

      if (result.updated > 0) {
        notify.success(`${result.updated} commande(s) mise(s) à jour`);
      }
      for (const failure of result.failed.slice(0, 3)) {
        notify.error(`${failure.number} — ${failure.message}`);
      }
      if (result.failed.length > 3) {
        notify.error(`et ${result.failed.length - 3} autre(s) refusée(s)`);
      }

      clear();
      table.refetch();
    } catch (error) {
      notify.error(message(error, "L'action groupée a échoué"));
    } finally {
      setBulkBusy(null);
    }
  }

  const { data: counts = {} } = useQuery({
    queryKey: ['admin', 'orders', 'counts'],
    queryFn: () => api<Record<string, number>>('/admin/orders/counts'),
    staleTime: 60_000,
  });

  const activeStatus = table.filters.status ?? [];

  const columns = useMemo<ColumnDef<OrderRow, unknown>[]>(
    () => [
      {
        id: 'number',
        header: 'Numéro',
        accessorKey: 'number',
        cell: ({ row }) => (
          <span className="font-medium tabular-nums text-ink">{row.original.number}</span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Date',
        accessorKey: 'createdAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted">
            {dateFormatter.format(new Date(row.original.createdAt))}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Statut',
        accessorKey: 'status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'customer',
        header: 'Client',
        accessorKey: 'customerName',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate">{row.original.customerName}</p>
            <a
              href={`tel:${row.original.customerPhone}`}
              className="text-xs text-muted hover:text-brass"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.customerPhone}
            </a>
          </div>
        ),
      },
      {
        id: 'wilaya',
        header: 'Livraison',
        accessorKey: 'wilayaName',
        enableSorting: true,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate">{row.original.wilayaName}</p>
            <p className="truncate text-xs text-muted">
              {row.original.communeName ?? '—'} ·{' '}
              {row.original.deliveryType === 'HOME' ? 'domicile' : 'stop desk'}
            </p>
          </div>
        ),
      },
      {
        id: 'itemCount',
        header: 'Art.',
        accessorKey: 'itemCount',
        enableSorting: false,
        cell: ({ row }) => <span className="tabular-nums text-muted">{row.original.itemCount}</span>,
      },
      {
        id: 'total',
        header: 'Total',
        accessorKey: 'total',
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-medium tabular-nums">
            {format(money(BigInt(row.original.total)))}
          </span>
        ),
      },
      {
        id: 'cogsTotal',
        header: 'Coût',
        accessorKey: 'cogsTotal',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-muted">
            {format(money(BigInt(row.original.cogsTotal)))}
          </span>
        ),
      },
      {
        id: 'paymentStatus',
        header: 'Paiement',
        accessorKey: 'paymentStatus',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <StatusBadge status={row.original.paymentStatus} />
            <span className="text-xs text-muted">{row.original.paymentMethod}</span>
          </div>
        ),
      },
      {
        id: 'source',
        header: 'Source',
        accessorKey: 'source',
        enableSorting: false,
        cell: ({ row }) => <span className="text-xs text-muted">{row.original.source}</span>,
      },
      {
        id: 'agentName',
        header: 'Agent',
        accessorKey: 'agentName',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted">{row.original.agentName ?? '—'}</span>
        ),
      },
      {
        id: 'riskScore',
        header: 'Risque',
        accessorKey: 'riskScore',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.riskScore >= 60 ? (
            <Badge tone="danger">{row.original.riskScore}</Badge>
          ) : row.original.riskScore >= 30 ? (
            <Badge tone="warning">{row.original.riskScore}</Badge>
          ) : (
            <span className="text-xs text-muted tabular-nums">{row.original.riskScore}</span>
          ),
      },
    ],
    [],
  );

  async function handleExport(format_: 'csv' | 'xlsx') {
    setExporting(true);
    try {
      await table.exportRows(format_);
      notify.success(`Export ${format_.toUpperCase()} téléchargé`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "L'export a échoué");
    } finally {
      setExporting(false);
    }
  }

  async function handleSaveView() {
    if (!viewName.trim()) return;
    try {
      await views.save(viewName.trim(), table.snapshot(), viewShared);
      notify.success('Vue enregistrée');
      setSaveOpen(false);
      setViewName('');
      setViewShared(false);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Enregistrement impossible');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Commandes"
        description="Le détail et les transitions arrivent au jalon M3. La liste, les filtres et les exports sont opérationnels."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)}>
              <BookmarkPlus className="h-4 w-4" />
              Enregistrer la vue
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" loading={exporting}>
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
          </>
        }
      />

      {views.views.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted">Vues</span>
          {views.views.map((view) => (
            <span key={view.id} className="flex items-center">
              <button
                type="button"
                onClick={() => table.applyView(view)}
                className="flex items-center gap-1.5 rounded-s-xs border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-brass hover:text-brass"
              >
                {view.isDefault ? <Star className="h-3 w-3 fill-current" aria-hidden /> : null}
                {view.name}
                {!view.isOwn ? <span className="text-[10px] opacity-70">(partagée)</span> : null}
              </button>
              {view.isOwn ? (
                <button
                  type="button"
                  aria-label={`Supprimer la vue ${view.name}`}
                  onClick={() => {
                    void views.remove(view.id).then(() => notify.success('Vue supprimée'));
                  }}
                  className="rounded-e-xs border border-s-0 border-line px-1.5 py-1 text-muted transition-colors hover:border-danger hover:text-danger"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max items-center gap-1 border-b border-line">
          {STATUS_TABS.map((tab) => {
            const selected =
              tab.value === 'ALL' ? activeStatus.length === 0 : activeStatus.includes(tab.value);
            const count = counts[tab.value] ?? 0;
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
                <span className="text-xs tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <DataTable<OrderRow>
        columns={columns}
        data={table.rows}
        getRowId={(row) => row.id}
        loading={table.loading}
        error={table.error?.message}
        onRetry={table.refetch}
        sorting={table.sorting}
        onSortingChange={table.setSorting}
        rowSelection={table.rowSelection}
        onRowSelectionChange={table.setRowSelection}
        columnVisibility={table.columnVisibility}
        onColumnVisibilityChange={table.setColumnVisibility}
        density={table.density}
        onDensityChange={table.setDensity}
        emptyTitle="Aucune commande"
        emptyDescription={
          table.activeFilterCount > 0
            ? 'Aucune commande ne correspond à ces filtres.'
            : 'Les commandes apparaîtront ici dès la première vente.'
        }
        emptyAction={
          table.activeFilterCount > 0 ? (
            <Button variant="outline" size="sm" onClick={table.clearFilters}>
              Effacer les filtres
            </Button>
          ) : null
        }
        onRowClick={(row) => navigate(`/orders/${row.id}`)}
        bulkActions={(ids, clear) => (
          <>
            {BULK_ACTIONS.map((action) => (
              <Button
                key={action.value}
                variant="outline"
                size="sm"
                loading={bulkBusy === action.value}
                onClick={() => void runBulk(action.value, ids, clear)}
              >
                {action.label} ({ids.length})
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              loading={printing === 'invoice'}
              onClick={() => void printBatch('invoice', ids)}
            >
              <Printer className="h-4 w-4" />
              Factures ({ids.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={printing === 'packing-slip'}
              onClick={() => void printBatch('packing-slip', ids)}
            >
              <Printer className="h-4 w-4" />
              Bons ({ids.length})
            </Button>
          </>
        )}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <Input
                className="h-9 w-64 ps-9"
                placeholder="Numéro, client, téléphone…"
                defaultValue={table.search}
                onChange={(event) => table.setSearch(event.target.value)}
                aria-label="Rechercher une commande"
              />
            </div>
            {table.activeFilterCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={table.clearFilters}>
                <X className="h-3.5 w-3.5" />
                {table.activeFilterCount} filtre{table.activeFilterCount > 1 ? 's' : ''}
              </Button>
            ) : null}
          </div>
        }
      />

      <TablePagination
        page={table.page}
        pageSize={table.pageSize}
        total={table.total}
        loading={table.fetching}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
      />

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enregistrer cette vue</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Nom" required>
              <Input
                value={viewName}
                autoFocus
                placeholder="À confirmer · Alger"
                onChange={(event) => setViewName(event.target.value)}
              />
            </Field>
            <SwitchField
              label="Partager avec l’équipe"
              description="Les autres membres pourront l’ouvrir, mais pas la modifier."
              checked={viewShared}
              onCheckedChange={setViewShared}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => void handleSaveView()} disabled={!viewName.trim()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
