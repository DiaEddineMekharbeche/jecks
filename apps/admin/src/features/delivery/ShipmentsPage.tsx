import { ShipmentStatus, type ShipmentRow } from '@jecks/shared';
import {
  Alert,
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
  MultiSelect,
  PageHeader,
  Select,
  TablePagination,
  Textarea,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, ExternalLink, FileUp, Printer, Search, Truck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { dateTimeFormatter, formatDa, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import * as delivery from './api';
import {
  DELIVERY_TYPE_LABELS,
  FAILURE_LABELS,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONES,
} from './labels';

/**
 * Shipments — PRD F-AD-61.
 *
 * The working screen of the module: what is out there, with whom, and how much cash is
 * riding on it. Selecting rows prints their labels, which is the single most repeated
 * action of a shop's morning.
 */

const STATUS_TABS = [
  { value: 'ALL', label: 'Toutes' },
  { value: ShipmentStatus.CREATED, label: 'À remettre' },
  { value: ShipmentStatus.IN_TRANSIT, label: 'En transit' },
  { value: ShipmentStatus.OUT_FOR_DELIVERY, label: 'En livraison' },
  { value: ShipmentStatus.DELIVERED, label: 'Livrées' },
  { value: ShipmentStatus.FAILED, label: 'Échecs' },
  { value: ShipmentStatus.RETURNED, label: 'Retours' },
];

export function ShipmentsPage() {
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const table = useServerTable<ShipmentRow>({
    module: 'shipments',
    endpoint: '/admin/shipments',
    defaultSort: 'createdAt',
    filterKeys: ['status', 'courierId', 'wilayaCode'],
  });

  const { data: counts = {} } = useQuery({
    queryKey: ['admin', 'shipments', 'counts'],
    queryFn: delivery.shipmentCounts,
    staleTime: 30_000,
  });

  const { data: couriers = [] } = useQuery({
    queryKey: ['admin', 'couriers'],
    queryFn: delivery.listCouriers,
    staleTime: 300_000,
  });

  const activeStatus = table.filters.status ?? [];
  const selectedIds = Object.keys(table.rowSelection).filter((id) => table.rowSelection[id]);

  async function printSelected() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      await delivery.printLabels(selectedIds);
      notify.success(`${selectedIds.length} étiquette(s) téléchargée(s)`);
    } catch (error) {
      notify.error(message(error, "L'impression a échoué"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(row: ShipmentRow) {
    if (!window.confirm(`Annuler l’expédition de la commande ${row.orderNumber} ?`)) return;
    try {
      await delivery.cancelShipment(row.id);
      notify.success('Expédition annulée');
      table.refetch();
    } catch (error) {
      notify.error(message(error, "L'annulation a échoué"));
    }
  }

  const columns = useMemo<ColumnDef<ShipmentRow, unknown>[]>(
    () => [
      {
        id: 'orderNumber',
        header: 'Commande',
        accessorKey: 'orderNumber',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.orderNumber}</p>
            <p className="truncate text-xs text-muted">{row.original.customerName}</p>
          </div>
        ),
      },
      {
        id: 'destination',
        header: 'Destination',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm">{row.original.wilayaName}</p>
            <p className="truncate text-xs text-muted">
              {row.original.communeName ?? DELIVERY_TYPE_LABELS[row.original.deliveryType]}
            </p>
          </div>
        ),
      },
      {
        id: 'carrier',
        header: 'Transporteur',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.courierName ?? row.original.driverName ?? 'Flotte'}
          </span>
        ),
      },
      {
        id: 'tracking',
        header: 'Suivi',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.trackingNumber ? (
            <a
              href={row.original.trackingUrl ?? '#'}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (!row.original.trackingUrl) event.preventDefault();
                event.stopPropagation();
              }}
              className="inline-flex items-center gap-1 font-mono text-xs text-brass hover:underline"
            >
              {row.original.trackingNumber}
              {row.original.trackingUrl ? <ExternalLink className="h-3 w-3" /> : null}
            </a>
          ) : (
            <span className="text-xs text-muted">en attente</span>
          ),
      },
      {
        id: 'status',
        header: 'État',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <Badge tone={SHIPMENT_STATUS_TONES[row.original.status] ?? 'neutral'}>
              {SHIPMENT_STATUS_LABELS[row.original.status] ?? row.original.status}
            </Badge>
            {row.original.failureReason ? (
              <span className="text-[11px] text-danger">
                {FAILURE_LABELS[row.original.failureReason]}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'codAmountMinor',
        header: 'À encaisser',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {BigInt(row.original.codAmountMinor) > 0n
              ? formatDa(row.original.codAmountMinor)
              : <span className="text-muted">payé</span>}
          </span>
        ),
      },
      {
        id: 'attempts',
        header: 'Tent.',
        enableSorting: false,
        cell: ({ row }) => (
          <span className={cn('tabular-nums', row.original.attempts > 1 && 'text-warning')}>
            {row.original.attempts}
          </span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Créée',
        accessorKey: 'createdAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {dateTimeFormatter.format(new Date(row.original.createdAt))}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.status === ShipmentStatus.DELIVERED ||
          row.original.status === ShipmentStatus.CANCELLED ? null : (
            <div
              className="flex justify-end"
              onClick={(event) => event.stopPropagation()}
              role="presentation"
            >
              <Button
                variant="ghost"
                size="sm"
                aria-label="Annuler l’expédition"
                onClick={() => void cancel(row.original)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ),
      },
    ],
    // `cancel` closes over the table, which is stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Expéditions"
        description="Ce qui est en route, chez qui, et combien de liquide est dessus."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <FileUp className="h-4 w-4" />
              Importer un suivi
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4" />
                  Exporter
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Format</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void table.exportRows('csv')}>
                  CSV
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void table.exportRows('xlsx')}>
                  Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              loading={busy}
              disabled={selectedIds.length === 0}
              onClick={() => void printSelected()}
            >
              <Printer className="h-4 w-4" />
              Étiquettes ({selectedIds.length})
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
                  {tab.value === 'ALL' ? (counts.ALL ?? 0) : (counts[tab.value] ?? 0)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <DataTable<ShipmentRow>
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
        emptyTitle="Aucune expédition"
        emptyDescription="Confiez des commandes à un transporteur depuis la liste des commandes."
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={table.search}
                onChange={(event) => table.setSearch(event.target.value)}
                placeholder="Commande, suivi ou téléphone"
                className="ps-9"
                aria-label="Rechercher une expédition"
              />
            </label>
            <MultiSelect
              options={couriers.map((courier) => ({ value: courier.id, label: courier.name }))}
              values={table.filters.courierId ?? []}
              onValuesChange={(values) => table.setFilter('courierId', values)}
              placeholder="Transporteur"
            />
            <MultiSelect
              options={Array.from({ length: 58 }, (_, index) => ({
                value: String(index + 1),
                label: String(index + 1).padStart(2, '0'),
              }))}
              values={table.filters.wilayaCode ?? []}
              onValuesChange={(values) => table.setFilter('wilayaCode', values)}
              placeholder="Wilaya"
            />
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

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false);
          table.refetch();
        }}
      />
    </div>
  );
}

/**
 * The spreadsheet a manual courier hands back.
 *
 * Pasted rather than uploaded: the file arrives as a WhatsApp photo or an Excel sheet
 * with different columns every week, and copying two columns out of it is faster than
 * teaching a parser about the third format this month.
 */
function ImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ matched: number; updated: number; unmatched: string[] } | null>(
    null,
  );

  const rows = parseRows(text);

  async function submit() {
    setBusy(true);
    try {
      const result = await delivery.importTracking({
        rows: rows.map((row) => ({
          orderNumber: row.orderNumber,
          trackingNumber: row.trackingNumber,
          ...(status ? { status } : {}),
        })),
      });
      setReport(result);
      notify.success(`${result.matched} expédition(s) mises à jour`);
      onDone();
    } catch (error) {
      notify.error(message(error, "L'import a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReport(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importer les numéros de suivi</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {report ? (
            <>
              <Alert tone="success" title={`${report.matched} expédition(s) mises à jour`}>
                {report.updated} ont aussi changé d’état.
              </Alert>
              {report.unmatched.length > 0 ? (
                <Alert tone="warning" title={`${report.unmatched.length} ligne(s) sans expédition`}>
                  <p className="mt-1 font-mono text-xs">{report.unmatched.join(', ')}</p>
                </Alert>
              ) : null}
            </>
          ) : (
            <>
              <Field
                label="Collez deux colonnes"
                hint="Numéro de commande puis numéro de suivi, séparés par une tabulation, une virgule ou un point-virgule."
              >
                <Textarea
                  rows={8}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={'JK-260910-0042\tYAL-99887766\nJK-260910-0043\tYAL-99887767'}
                  className="font-mono text-xs"
                />
              </Field>

              <Field label="Marquer aussi comme" hint="Facultatif.">
                <Select
                  value={status}
                  onValueChange={setStatus}
                  options={[
                    { value: '', label: 'Ne pas changer l’état' },
                    { value: ShipmentStatus.PICKED_UP, label: 'Ramassée' },
                    { value: ShipmentStatus.IN_TRANSIT, label: 'En transit' },
                    { value: ShipmentStatus.DELIVERED, label: 'Livrée' },
                    { value: ShipmentStatus.RETURNED, label: 'Retournée' },
                  ]}
                />
              </Field>

              <p className="text-xs text-muted">
                {rows.length} ligne(s) lisible(s).
              </p>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          {report ? null : (
            <Button loading={busy} disabled={rows.length === 0} onClick={() => void submit()}>
              <Truck className="h-4 w-4" />
              Importer {rows.length} ligne(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reads whatever separator the courier's spreadsheet happened to use. */
function parseRows(text: string): Array<{ orderNumber: string; trackingNumber: string }> {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/[\t,;]+/).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2 && cells[0] && cells[1])
    .map((cells) => ({ orderNumber: cells[0]!, trackingNumber: cells[1]! }))
    .slice(0, 1000);
}
