import { ProductStatus, format, money, t, type ImportReport, type ProductRow } from '@jecks/shared';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
  MoneyInput,
  MultiSelect,
  PageHeader,
  Select,
  StatusBadge,
  SwitchField,
  TablePagination,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Archive,
  ArchiveRestore,
  Copy,
  Download,
  FileUp,
  ImageOff,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '@/lib/api';
import { useServerTable } from '@/lib/server-table';
import * as catalog from './api';
import {
  useBrands,
  useCatalogInvalidate,
  useCategoryTree,
  useCollections,
  useTags,
} from './queries';
import { flattenTree } from './tree';

/**
 * Products list — PRD F-AD-10.
 *
 * Every number on this screen comes from `/admin/products`: the rows, the tab counters,
 * the export and the bulk results. The browser formats money and dates and nothing else.
 */

const STATUS_TABS = [
  { value: 'ALL', label: 'Tous' },
  { value: ProductStatus.ACTIVE, label: 'En ligne' },
  { value: ProductStatus.DRAFT, label: 'Brouillons' },
  { value: ProductStatus.ARCHIVED, label: 'Archivés' },
];

const STOCK_LABELS: Record<string, string> = {
  in: 'En stock',
  low: 'Stock bas',
  out: 'Rupture',
};

const dateFormatter = new Intl.DateTimeFormat('fr-DZ', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
});

export function ProductsListPage() {
  const navigate = useNavigate();
  const invalidate = useCatalogInvalidate();

  const table = useServerTable<ProductRow>({
    module: 'products',
    endpoint: '/admin/products',
    defaultSort: 'updatedAt',
    filterKeys: [
      'status',
      'categoryId',
      'collectionId',
      'brandId',
      'tagId',
      'stock',
      'minPrice',
      'maxPrice',
      'hasMedia',
    ],
    defaultHiddenColumns: ['salesCount', 'rating', 'collectionCount'],
  });

  const categories = useCategoryTree();
  const collections = useCollections();
  const brands = useBrands();
  const tags = useTags();

  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data: counts = {} } = useQuery({
    queryKey: ['admin', 'products', 'counts', table.filters],
    queryFn: () => catalog.getProductCounts(withoutStatus(table.filters)),
    staleTime: 30_000,
  });

  const activeStatus = table.filters.status ?? [];

  const categoryOptions = useMemo(
    () =>
      flattenTree(categories.data ?? []).map((node) => ({
        value: node.id,
        label: `${'— '.repeat(node.depth)}${t(node.name, 'fr')}`,
      })),
    [categories.data],
  );

  const collectionOptions = useMemo(
    () =>
      (collections.data ?? []).map((collection) => ({
        value: collection.id,
        label: t(collection.name, 'fr'),
        description: collection.isSmart ? 'Automatique' : undefined,
      })),
    [collections.data],
  );

  const brandOptions = useMemo(
    () => (brands.data ?? []).map((brand) => ({ value: brand.id, label: brand.name })),
    [brands.data],
  );

  const tagOptions = useMemo(
    () => (tags.data ?? []).map((tag) => ({ value: tag.id, label: t(tag.name, 'fr') })),
    [tags.data],
  );

  const columns = useMemo<ColumnDef<ProductRow, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Produit',
        accessorKey: 'slug',
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <Thumbnail row={row.original} />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{t(row.original.name, 'fr')}</p>
              <p className="truncate text-xs text-muted">
                {row.original.slug} · {row.original.variantCount} variante
                {row.original.variantCount > 1 ? 's' : ''}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Statut',
        accessorKey: 'status',
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <StatusBadge status={row.original.status} />
            {row.original.status === ProductStatus.ACTIVE &&
            row.original.publishedAt &&
            new Date(row.original.publishedAt) > new Date() ? (
              <span className="text-[11px] text-brass">
                programmé {dateFormatter.format(new Date(row.original.publishedAt))}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'category',
        header: 'Catégorie',
        accessorKey: 'categoryName',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate">{t(row.original.categoryName ?? {}, 'fr') || '—'}</p>
            <p className="truncate text-xs text-muted">{row.original.brandName ?? '—'}</p>
          </div>
        ),
      },
      {
        id: 'price',
        header: 'Prix',
        accessorKey: 'minPrice',
        cell: ({ row }) => <PriceRange row={row.original} />,
      },
      {
        id: 'stock',
        header: 'Stock',
        accessorKey: 'totalStock',
        cell: ({ row }) => <StockCell row={row.original} />,
      },
      {
        id: 'sales',
        header: 'Ventes',
        accessorKey: 'salesCount',
        cell: ({ row }) => (
          <span className="tabular-nums text-muted">{row.original.salesCount}</span>
        ),
      },
      {
        id: 'rating',
        header: 'Note',
        accessorKey: 'ratingAverage',
        cell: ({ row }) =>
          row.original.ratingCount === 0 ? (
            <span className="text-xs text-muted">—</span>
          ) : (
            <span className="whitespace-nowrap text-sm tabular-nums">
              {row.original.ratingAverage.toFixed(1)}
              <span className="text-xs text-muted"> ({row.original.ratingCount})</span>
            </span>
          ),
      },
      {
        id: 'collectionCount',
        header: 'Collections',
        accessorKey: 'collectionCount',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted">{row.original.collectionCount}</span>
        ),
      },
      {
        id: 'updatedAt',
        header: 'Modifié',
        accessorKey: 'updatedAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {dateFormatter.format(new Date(row.original.updatedAt))}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            row={row.original}
            busy={busy}
            onDuplicate={() => void handleDuplicate(row.original)}
            onArchive={() =>
              void handleArchive([row.original.id], row.original.status !== ProductStatus.ARCHIVED)
            }
          />
        ),
      },
    ],
    // `handleDuplicate` and `handleArchive` are stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy],
  );

  async function handleDuplicate(row: ProductRow) {
    setBusy(true);
    try {
      const copy = await catalog.duplicateProduct(row.id);
      notify.success(`« ${t(row.name, 'fr')} » dupliqué`);
      invalidate();
      navigate(`/catalog/products/${copy.id}`);
    } catch (error) {
      notify.error(message(error, 'La duplication a échoué'));
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(ids: string[], archived: boolean) {
    setBusy(true);
    try {
      const result = await catalog.archiveProducts(ids, archived);
      notify.success(
        archived
          ? `${result.updated} produit${result.updated > 1 ? 's' : ''} archivé${result.updated > 1 ? 's' : ''}`
          : `${result.updated} produit${result.updated > 1 ? 's' : ''} remis en brouillon`,
      );
      table.clearSelection();
      invalidate();
    } catch (error) {
      notify.error(message(error, "L'archivage a échoué"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(ids: string[]) {
    setBusy(true);
    try {
      const result = await catalog.deleteProducts(ids);
      if (result.deleted > 0) notify.success(`${result.deleted} produit(s) supprimé(s)`);
      for (const failure of result.failed) notify.error(failure.message);
      table.clearSelection();
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    } finally {
      setBusy(false);
    }
  }

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
        title="Produits"
        description="Créez, dupliquez, publiez et mettez à jour tout le catalogue."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <FileUp className="h-4 w-4" />
              Importer
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
                <DropdownMenuItem onSelect={() => void handleExport('csv')}>CSV</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleExport('xlsx')}>
                  Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => navigate('/catalog/products/new')}>
              <Plus className="h-4 w-4" />
              Nouveau produit
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
                <span className="text-xs tabular-nums opacity-70">{counts[tab.value] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      <DataTable<ProductRow>
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
        onRowClick={(row) => navigate(`/catalog/products/${row.id}`)}
        emptyTitle="Aucun produit"
        emptyDescription={
          table.activeFilterCount > 0
            ? 'Aucun produit ne correspond à ces filtres.'
            : 'Créez votre premier produit ou importez un fichier.'
        }
        emptyAction={
          table.activeFilterCount > 0 ? (
            <Button variant="outline" size="sm" onClick={table.clearFilters}>
              Effacer les filtres
            </Button>
          ) : (
            <Button size="sm" onClick={() => navigate('/catalog/products/new')}>
              <Plus className="h-4 w-4" />
              Nouveau produit
            </Button>
          )
        }
        bulkActions={(ids) => (
          <>
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
              Modifier ({ids.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={busy}
              onClick={() => void handleArchive(ids, true)}
            >
              <Archive className="h-3.5 w-3.5" />
              Archiver
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={busy}
              onClick={() => void handleArchive(ids, false)}
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
              Restaurer
            </Button>
            <Button variant="ghost" size="sm" loading={busy} onClick={() => void handleDelete(ids)}>
              <Trash2 className="h-3.5 w-3.5" />
              Supprimer
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
                placeholder="Nom, slug ou SKU…"
                defaultValue={table.search}
                onChange={(event) => table.setSearch(event.target.value)}
                aria-label="Rechercher un produit"
              />
            </div>

            <Select
              className="h-9 w-40"
              value={table.filters.stock?.[0] ?? ''}
              onValueChange={(value) => table.setFilter('stock', value ? [value] : [])}
              placeholder="Stock"
              options={[
                { value: '', label: 'Tout le stock' },
                ...Object.entries(STOCK_LABELS).map(([value, label]) => ({ value, label })),
              ]}
            />

            <MultiSelect
              className="w-52"
              options={categoryOptions}
              values={table.filters.categoryId ?? []}
              onValuesChange={(values) => table.setFilter('categoryId', values)}
              placeholder="Catégorie"
            />

            <MultiSelect
              className="w-52"
              options={collectionOptions}
              values={table.filters.collectionId ?? []}
              onValuesChange={(values) => table.setFilter('collectionId', values)}
              placeholder="Collection"
            />

            <MultiSelect
              className="w-44"
              options={brandOptions}
              values={table.filters.brandId ?? []}
              onValuesChange={(values) => table.setFilter('brandId', values)}
              placeholder="Marque"
            />

            <MultiSelect
              className="w-44"
              options={tagOptions}
              values={table.filters.tagId ?? []}
              onValuesChange={(values) => table.setFilter('tagId', values)}
              placeholder="Étiquette"
            />

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

      <BulkEditDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        ids={table.selectedIds}
        categoryOptions={categoryOptions}
        collectionOptions={collectionOptions.filter(
          (option) => option.description !== 'Automatique',
        )}
        brandOptions={brandOptions}
        tagOptions={tagOptions}
        onDone={() => {
          table.clearSelection();
          invalidate();
        }}
      />

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={() => invalidate()} />
    </div>
  );
}

// --- cells ------------------------------------------------------------------

function Thumbnail({ row }: { row: ProductRow }) {
  if (!row.thumbnailUrl) {
    return (
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xs border border-line bg-base"
        title="Aucune image"
      >
        <ImageOff className="h-4 w-4 text-muted" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={row.thumbnailUrl}
      alt=""
      loading="lazy"
      className="h-10 w-10 shrink-0 rounded-xs border border-line object-cover"
    />
  );
}

function PriceRange({ row }: { row: ProductRow }) {
  const min = BigInt(row.minPrice);
  const max = BigInt(row.maxPrice);
  return (
    <div className="whitespace-nowrap">
      <p className="font-medium tabular-nums">
        {min === max ? format(money(min)) : `${format(money(min))} – ${format(money(max))}`}
      </p>
      {row.maxCompareAt ? (
        <p className="text-xs tabular-nums text-muted line-through">
          {format(money(BigInt(row.maxCompareAt)))}
        </p>
      ) : null}
    </div>
  );
}

function StockCell({ row }: { row: ProductRow }) {
  if (row.totalStock <= 0) return <Badge tone="danger">Rupture</Badge>;
  if (row.totalStock <= row.lowStockThreshold) {
    return <Badge tone="warning">{row.totalStock} restants</Badge>;
  }
  return <span className="tabular-nums text-muted">{row.totalStock}</span>;
}

function RowActions({
  row,
  busy,
  onDuplicate,
  onArchive,
}: {
  row: ProductRow;
  busy: boolean;
  onDuplicate: () => void;
  onArchive: () => void;
}) {
  const archived = row.status === ProductStatus.ARCHIVED;
  return (
    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={busy} aria-label="Actions">
            ⋯
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDuplicate}>
            <Copy className="h-3.5 w-3.5" />
            Dupliquer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onArchive}>
            {archived ? (
              <>
                <ArchiveRestore className="h-3.5 w-3.5" />
                Restaurer
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5" />
                Archiver
              </>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// --- bulk edit --------------------------------------------------------------

interface Option {
  value: string;
  label: string;
  description?: string;
}

function BulkEditDialog({
  open,
  onOpenChange,
  ids,
  categoryOptions,
  collectionOptions,
  brandOptions,
  tagOptions,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: string[];
  categoryOptions: Option[];
  collectionOptions: Option[];
  brandOptions: Option[];
  tagOptions: Option[];
  onDone: () => void;
}) {
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [addCollectionIds, setAddCollectionIds] = useState<string[]>([]);
  const [removeCollectionIds, setRemoveCollectionIds] = useState<string[]>([]);
  const [addTagIds, setAddTagIds] = useState<string[]>([]);
  const [removeTagIds, setRemoveTagIds] = useState<string[]>([]);
  const [priceOn, setPriceOn] = useState(false);
  const [priceMode, setPriceMode] = useState<'set' | 'increase' | 'decrease'>('increase');
  const [priceTarget, setPriceTarget] = useState<'price' | 'compareAtPrice' | 'costPrice'>('price');
  const [priceBy, setPriceBy] = useState<'percent' | 'amount'>('percent');
  const [percent, setPercent] = useState('10');
  const [amountMinor, setAmountMinor] = useState<bigint | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await catalog.bulkUpdateProducts({
        ids,
        ...(status ? { status } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(brandId ? { brandId } : {}),
        addCollectionIds,
        removeCollectionIds,
        addTagIds,
        removeTagIds,
        ...(priceOn
          ? {
              price: {
                mode: priceMode,
                target: priceTarget,
                ...(priceBy === 'percent'
                  ? { percent: Number(percent) }
                  : { amountMinor: (amountMinor ?? 0n).toString() }),
              },
            }
          : {}),
      });
      notify.success(`${ids.length} produit${ids.length > 1 ? 's' : ''} mis à jour`);
      onOpenChange(false);
      onDone();
    } catch (error) {
      notify.error(message(error, 'La modification groupée a échoué'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modifier {ids.length} produit(s)</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
          <p className="text-sm text-muted">
            Seuls les champs renseignés sont appliqués. Les autres restent inchangés.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Statut">
              <Select
                value={status}
                onValueChange={setStatus}
                placeholder="Ne pas changer"
                options={[
                  { value: '', label: 'Ne pas changer' },
                  { value: ProductStatus.ACTIVE, label: 'En ligne' },
                  { value: ProductStatus.DRAFT, label: 'Brouillon' },
                  { value: ProductStatus.ARCHIVED, label: 'Archivé' },
                ]}
              />
            </Field>

            <Field label="Catégorie">
              <Select
                value={categoryId}
                onValueChange={setCategoryId}
                placeholder="Ne pas changer"
                options={[{ value: '', label: 'Ne pas changer' }, ...categoryOptions]}
              />
            </Field>

            <Field label="Marque">
              <Select
                value={brandId}
                onValueChange={setBrandId}
                placeholder="Ne pas changer"
                options={[{ value: '', label: 'Ne pas changer' }, ...brandOptions]}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ajouter aux collections">
              <MultiSelect
                options={collectionOptions}
                values={addCollectionIds}
                onValuesChange={setAddCollectionIds}
                placeholder="Aucune"
              />
            </Field>
            <Field label="Retirer des collections">
              <MultiSelect
                options={collectionOptions}
                values={removeCollectionIds}
                onValuesChange={setRemoveCollectionIds}
                placeholder="Aucune"
              />
            </Field>
            <Field label="Ajouter des étiquettes">
              <MultiSelect
                options={tagOptions}
                values={addTagIds}
                onValuesChange={setAddTagIds}
                placeholder="Aucune"
              />
            </Field>
            <Field label="Retirer des étiquettes">
              <MultiSelect
                options={tagOptions}
                values={removeTagIds}
                onValuesChange={setRemoveTagIds}
                placeholder="Aucune"
              />
            </Field>
          </div>

          <SwitchField
            label="Modifier les prix"
            description="Appliqué à chaque variante des produits sélectionnés."
            checked={priceOn}
            onCheckedChange={setPriceOn}
          />

          {priceOn ? (
            <div className="grid gap-4 rounded-xs border border-line p-3 sm:grid-cols-2">
              <Field label="Champ">
                <Select
                  value={priceTarget}
                  onValueChange={(value) => setPriceTarget(value as typeof priceTarget)}
                  options={[
                    { value: 'price', label: 'Prix de vente' },
                    { value: 'compareAtPrice', label: 'Prix barré' },
                    { value: 'costPrice', label: 'Prix de revient' },
                  ]}
                />
              </Field>
              <Field label="Opération">
                <Select
                  value={priceMode}
                  onValueChange={(value) => setPriceMode(value as typeof priceMode)}
                  options={[
                    { value: 'increase', label: 'Augmenter' },
                    { value: 'decrease', label: 'Diminuer' },
                    { value: 'set', label: 'Fixer à' },
                  ]}
                />
              </Field>
              <Field label="Par">
                <Select
                  value={priceBy}
                  onValueChange={(value) => setPriceBy(value as typeof priceBy)}
                  options={[
                    { value: 'percent', label: 'Pourcentage' },
                    { value: 'amount', label: 'Montant' },
                  ]}
                  disabled={priceMode === 'set'}
                />
              </Field>
              <Field
                label={priceBy === 'percent' && priceMode !== 'set' ? 'Pourcentage' : 'Montant'}
              >
                {priceBy === 'percent' && priceMode !== 'set' ? (
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    step="0.1"
                    value={percent}
                    onChange={(event) => setPercent(event.target.value)}
                  />
                ) : (
                  <MoneyInput value={amountMinor} onValueChange={setAmountMinor} />
                )}
              </Field>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button loading={saving} onClick={() => void submit()}>
            Appliquer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- import -----------------------------------------------------------------

function ImportDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [running, setRunning] = useState(false);

  async function run(dryRun: boolean) {
    if (!file) return;
    setRunning(true);
    try {
      const result = await catalog.importProducts(file, { dryRun, updateExisting });
      setReport(result);
      if (!dryRun) {
        notify.success(
          `${result.productsCreated} produits créés, ${result.variantsCreated} variantes ajoutées`,
        );
        onDone();
      }
    } catch (error) {
      notify.error(message(error, "L'import a échoué"));
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    setFile(null);
    setReport(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const blocking = (report?.issues.length ?? 0) > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importer des produits</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
          <p className="text-sm text-muted">
            Une ligne par variante, identifiée par son SKU. Les lignes qui partagent un slug
            deviennent un même produit. Les prix sont en dinars.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={catalog.importTemplateUrl('csv')}
              className="text-sm text-brass underline underline-offset-4"
            >
              Télécharger le modèle CSV
            </a>
            <span className="text-muted">·</span>
            <a
              href={catalog.importTemplateUrl('xlsx')}
              className="text-sm text-brass underline underline-offset-4"
            >
              modèle Excel
            </a>
          </div>

          <Field label="Fichier" required>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,text/csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setReport(null);
              }}
              className="block w-full text-sm text-muted file:me-3 file:rounded-xs file:border file:border-line file:bg-base file:px-3 file:py-1.5 file:text-sm file:text-ink"
            />
          </Field>

          <SwitchField
            label="Mettre à jour les SKU existants"
            description="Sinon, une ligne dont le SKU existe déjà est ignorée."
            checked={updateExisting}
            onCheckedChange={setUpdateExisting}
          />

          {report ? <ImportReportView report={report} /> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <Button
            variant="outline"
            loading={running}
            disabled={!file}
            onClick={() => void run(true)}
          >
            Vérifier
          </Button>
          <Button
            loading={running}
            disabled={!file || !report || blocking}
            title={blocking ? 'Corrigez les erreurs signalées avant d’importer' : undefined}
            onClick={() => void run(false)}
          >
            Importer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportReportView({ report }: { report: ImportReport }) {
  return (
    <div className="flex flex-col gap-3">
      <Alert tone={report.issues.length > 0 ? 'warning' : 'success'} title={report.fileName}>
        {report.dryRun ? 'Vérification — rien n’a été écrit.' : 'Import terminé.'}
      </Alert>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <Stat label="Lignes" value={report.totalRows} />
        <Stat label="Produits créés" value={report.productsCreated} />
        <Stat label="Produits mis à jour" value={report.productsUpdated} />
        <Stat label="Variantes créées" value={report.variantsCreated} />
        <Stat label="Variantes mises à jour" value={report.variantsUpdated} />
        <Stat label="Ignorées" value={report.skipped} />
      </dl>

      {report.issues.length > 0 ? (
        <div className="max-h-64 overflow-y-auto rounded-xs border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-base text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 text-start">Ligne</th>
                <th className="px-3 py-2 text-start">Colonne</th>
                <th className="px-3 py-2 text-start">Problème</th>
              </tr>
            </thead>
            <tbody>
              {report.issues.map((issue, index) => (
                <tr key={`${issue.row}-${index}`} className="border-t border-line">
                  <td className="px-3 py-1.5 tabular-nums">{issue.row}</td>
                  <td className="px-3 py-1.5 text-muted">{issue.column ?? '—'}</td>
                  <td className="px-3 py-1.5">{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xs border border-line px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}

// --- helpers ----------------------------------------------------------------

/** The status tabs must show their own counts while another tab is selected. */
function withoutStatus(filters: Record<string, string[]>): Record<string, string[]> {
  const { status: _ignored, ...rest } = filters;
  return rest;
}

export function message(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : fallback;
}
