import {
  StockMovementReason,
  t,
  type InventoryRow,
  type LocationDto,
  type StockFilterState,
} from '@jecks/shared';
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
  MultiSelect,
  PageHeader,
  Select,
  StatTile,
  TablePagination,
  Textarea,
  cn,
  notify,
} from '@jecks/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeftRight, Download, ImageOff, PackageSearch, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDa, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import { useBrands, useCategoryTree } from '@/features/catalog/queries';
import { flattenTree } from '@/features/catalog/tree';
import * as inventory from './api';
import { useInventoryInvalidate, useInventorySummary, useLocations } from './queries';

/**
 * Stock overview — PRD F-AD-50.
 *
 * One row per variant and location, because that is what an operator acts on. The
 * tiles above it read the same filter set as the table, so narrowing to one warehouse
 * narrows the valuation with it rather than leaving a total that means something else.
 */

const STATE_TABS: Array<{ value: StockFilterState | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Tout' },
  { value: 'low', label: 'Stock bas' },
  { value: 'out', label: 'Rupture' },
  { value: 'negative', label: 'Négatif' },
];

const STATE_TONES: Record<StockFilterState, 'success' | 'warning' | 'danger' | 'neutral'> = {
  in: 'success',
  low: 'warning',
  out: 'danger',
  negative: 'danger',
};

const STATE_LABELS: Record<StockFilterState, string> = {
  in: 'En stock',
  low: 'Bas',
  out: 'Rupture',
  negative: 'Négatif',
};

const REASONS: Array<{ value: string; label: string }> = [
  { value: StockMovementReason.ADJUSTMENT, label: 'Correction' },
  { value: StockMovementReason.DAMAGED, label: 'Casse / perte' },
  { value: StockMovementReason.RETURN, label: 'Retour client' },
  { value: StockMovementReason.PURCHASE, label: 'Réception hors commande' },
  { value: StockMovementReason.STOCK_COUNT, label: 'Inventaire' },
];

export function StockOverviewPage() {
  const invalidate = useInventoryInvalidate();
  const locations = useLocations();
  const categories = useCategoryTree();
  const brands = useBrands();

  const table = useServerTable<InventoryRow>({
    module: 'stock',
    endpoint: '/admin/inventory',
    defaultSort: 'onHand',
    defaultOrder: 'asc',
    filterKeys: ['locationId', 'state', 'categoryId', 'brandId'],
    defaultHiddenColumns: ['incoming', 'costPriceMinor'],
  });

  const summary = useInventorySummary(table.filters);

  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const [transferring, setTransferring] = useState<InventoryRow | null>(null);

  const activeState = table.filters.state ?? [];

  const categoryOptions = useMemo(
    () =>
      flattenTree(categories.data ?? []).map((node) => ({
        value: node.id,
        label: `${'— '.repeat(node.depth)}${t(node.name, 'fr')}`,
      })),
    [categories.data],
  );

  const brandOptions = useMemo(
    () => (brands.data ?? []).map((brand) => ({ value: brand.id, label: brand.name })),
    [brands.data],
  );

  const columns = useMemo<ColumnDef<InventoryRow, unknown>[]>(
    () => [
      {
        id: 'sku',
        header: 'Article',
        accessorKey: 'sku',
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            {row.original.imageUrl ? (
              <img
                src={row.original.imageUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-sm object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-line text-muted">
                <ImageOff className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{t(row.original.productName, 'fr')}</p>
              <p className="truncate text-xs text-muted">
                {row.original.sku}
                {row.original.variantName ? ` · ${row.original.variantName}` : ''}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: 'location',
        header: 'Emplacement',
        accessorKey: 'location',
        cell: ({ row }) => <span className="text-sm">{row.original.locationName}</span>,
      },
      {
        id: 'onHand',
        header: 'En stock',
        accessorKey: 'onHand',
        cell: ({ row }) => (
          <span
            className={cn(
              'tabular-nums',
              row.original.onHand < 0 ? 'font-semibold text-danger' : undefined,
            )}
          >
            {row.original.onHand}
          </span>
        ),
      },
      {
        id: 'reserved',
        header: 'Réservé',
        accessorKey: 'reserved',
        cell: ({ row }) => <span className="tabular-nums text-muted">{row.original.reserved}</span>,
      },
      {
        id: 'available',
        header: 'Disponible',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">{row.original.available}</span>
        ),
      },
      {
        id: 'incoming',
        header: 'Entrant',
        enableSorting: false,
        cell: ({ row }) => <span className="tabular-nums text-muted">{row.original.incoming}</span>,
      },
      {
        id: 'state',
        header: 'État',
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone={STATE_TONES[row.original.state]}>{STATE_LABELS[row.original.state]}</Badge>
        ),
      },
      {
        id: 'costPriceMinor',
        header: 'Coût unitaire',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted">{formatDa(row.original.costPriceMinor)}</span>
        ),
      },
      {
        id: 'valuation',
        header: 'Valorisation',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatDa(row.original.valuationMinor)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setAdjusting(row.original)}>
              <SlidersHorizontal className="h-4 w-4" />
              Ajuster
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setTransferring(row.original)}>
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
          </div>
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
        title="Stock"
        description="Niveaux par variante et par emplacement, avec la valorisation au coût."
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Unités en stock"
          value={summary.data?.onHand ?? 0}
          hint={`${summary.data?.available ?? 0} disponibles`}
          loading={summary.isLoading}
        />
        <StatTile
          label="Valorisation au coût"
          value={formatDa(summary.data?.valuationMinor ?? 0)}
          hint={`Valeur de vente ${formatDa(summary.data?.retailValueMinor ?? 0)}`}
          loading={summary.isLoading}
        />
        <StatTile
          label="Stock bas"
          value={summary.data?.lowCount ?? 0}
          hint="Sous le seuil du produit"
          loading={summary.isLoading}
        />
        <StatTile
          label="Ruptures"
          value={summary.data?.outCount ?? 0}
          hint="Rien de disponible à la vente"
          loading={summary.isLoading}
        />
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max items-center gap-1 border-b border-line">
          {STATE_TABS.map((tab) => {
            const selected =
              tab.value === 'ALL' ? activeState.length === 0 : activeState.includes(tab.value);
            return (
              <button
                key={tab.value}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  tab.value === 'ALL'
                    ? table.setFilter('state', [])
                    : table.setFilter('state', selected ? [] : [tab.value])
                }
                className={cn(
                  'relative whitespace-nowrap px-3 py-2.5 text-sm transition-colors',
                  selected
                    ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brass'
                    : 'text-muted hover:text-ink',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <DataTable<InventoryRow>
        columns={columns}
        data={table.rows}
        getRowId={(row) => `${row.variantId}:${row.locationId}`}
        loading={table.loading}
        error={table.error?.message}
        onRetry={table.refetch}
        sorting={table.sorting}
        onSortingChange={table.setSorting}
        columnVisibility={table.columnVisibility}
        onColumnVisibilityChange={table.setColumnVisibility}
        density={table.density}
        onDensityChange={table.setDensity}
        emptyTitle="Aucun article en stock"
        emptyDescription="Créez des produits et recevez une commande fournisseur pour remplir cette liste."
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={table.search}
                onChange={(event) => table.setSearch(event.target.value)}
                placeholder="SKU, code-barres ou produit"
                className="ps-9"
                aria-label="Rechercher dans le stock"
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
              options={categoryOptions}
              values={table.filters.categoryId ?? []}
              onValuesChange={(values) => table.setFilter('categoryId', values)}
              placeholder="Catégorie"
            />
            <MultiSelect
              options={brandOptions}
              values={table.filters.brandId ?? []}
              onValuesChange={(values) => table.setFilter('brandId', values)}
              placeholder="Marque"
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
      />

      <AdjustDialog
        row={adjusting}
        onClose={() => setAdjusting(null)}
        onDone={() => {
          invalidate();
          void summary.refetch();
        }}
      />
      <TransferDialog
        row={transferring}
        locations={locations.data ?? []}
        onClose={() => setTransferring(null)}
        onDone={() => {
          invalidate();
          void summary.refetch();
        }}
      />
    </div>
  );
}

function AdjustDialog({
  row,
  onClose,
  onDone,
}: {
  row: InventoryRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'delta' | 'set'>('delta');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<string>(StockMovementReason.ADJUSTMENT);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = Number(quantity);
  const valid = quantity.trim() !== '' && Number.isInteger(parsed);
  const resulting = row ? (mode === 'set' ? parsed : row.onHand + parsed) : 0;

  async function submit() {
    if (!row || !valid) return;
    setBusy(true);
    try {
      await inventory.adjustStock({
        variantId: row.variantId,
        locationId: row.locationId,
        quantity: parsed,
        mode,
        reason: reason as never,
        note: note || undefined,
      });
      notify.success(`Stock ajusté pour ${row.sku}`);
      onDone();
      close();
    } catch (error) {
      notify.error(message(error, "L'ajustement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setQuantity('');
    setNote('');
    setMode('delta');
    setReason(StockMovementReason.ADJUSTMENT);
    onClose();
  }

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajuster le stock</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {row ? (
            <p className="text-sm text-muted">
              {t(row.productName, 'fr')} · {row.sku} · {row.locationName} — actuellement{' '}
              <span className="font-medium text-ink tabular-nums">{row.onHand}</span> en stock.
            </p>
          ) : null}

          <Field label="Type d’ajustement">
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as 'delta' | 'set')}
              options={[
                { value: 'delta', label: 'Ajouter / retirer' },
                { value: 'set', label: 'Fixer la quantité' },
              ]}
            />
          </Field>

          <Field
            label={mode === 'delta' ? 'Quantité (négatif pour retirer)' : 'Nouvelle quantité'}
            hint={
              valid && row
                ? `Le stock passera à ${resulting}`
                : 'Entrez un nombre entier'
            }
          >
            <Input
              type="number"
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder={mode === 'delta' ? '-3' : '12'}
            />
          </Field>

          <Field label="Motif">
            <Select value={reason} onValueChange={setReason} options={REASONS} />
          </Field>

          <Field label="Note" hint="Visible dans le journal des mouvements">
            <Textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Carton abîmé à la réception"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={!valid} loading={busy}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  row,
  locations,
  onClose,
  onDone,
}: {
  row: InventoryRow | null;
  locations: LocationDto[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = Number(quantity);
  const valid =
    Boolean(row) && target !== '' && Number.isInteger(parsed) && parsed > 0 && parsed <= (row?.available ?? 0);

  async function submit() {
    if (!row || !valid) return;
    setBusy(true);
    try {
      await inventory.transferStock({
        variantId: row.variantId,
        fromLocationId: row.locationId,
        toLocationId: target,
        quantity: parsed,
        note: note || undefined,
      });
      notify.success(`${parsed} unité(s) transférée(s)`);
      onDone();
      close();
    } catch (error) {
      notify.error(message(error, 'Le transfert a échoué'));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setTarget('');
    setQuantity('');
    setNote('');
    onClose();
  }

  const options = locations
    .filter((location) => location.id !== row?.locationId && location.active)
    .map((location) => ({ value: location.id, label: location.name }));

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transférer du stock</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {row ? (
            <p className="text-sm text-muted">
              {row.sku} — {row.available} disponible(s) à {row.locationName}.
            </p>
          ) : null}

          {options.length === 0 ? (
            <p className="text-sm text-danger">
              Créez un second emplacement pour pouvoir transférer du stock.
            </p>
          ) : (
            <Field label="Vers">
              <Select
                value={target}
                onValueChange={setTarget}
                options={options}
                placeholder="Choisir un emplacement"
              />
            </Field>
          )}

          <Field label="Quantité">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={row?.available ?? undefined}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>

          <Field label="Note">
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={!valid} loading={busy}>
            <PackageSearch className="h-4 w-4" />
            Transférer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
