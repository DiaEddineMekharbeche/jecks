import { t, type StockCountRow } from '@jecks/shared';
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
  Field,
  Input,
  PageHeader,
  Select,
  TablePagination,
  Textarea,
  notify,
} from '@jecks/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { ClipboardList, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCategoryTree } from '@/features/catalog/queries';
import { flattenTree } from '@/features/catalog/tree';
import { dateFormatter, formatDa, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import * as inventory from './api';
import { useInventoryInvalidate, useLocations } from './queries';

/** Stock count sessions — PRD F-AD-51. */

export const COUNT_STATUS_LABELS: Record<string, string> = {
  OPEN: 'En cours',
  APPLIED: 'Appliqué',
  CANCELLED: 'Annulé',
};

export const COUNT_STATUS_TONES: Record<string, 'warning' | 'success' | 'neutral'> = {
  OPEN: 'warning',
  APPLIED: 'success',
  CANCELLED: 'neutral',
};

export function StockCountsPage() {
  const navigate = useNavigate();
  const invalidate = useInventoryInvalidate();
  const [starting, setStarting] = useState(false);

  const table = useServerTable<StockCountRow>({
    module: 'stock-counts',
    endpoint: '/admin/stock-counts',
    defaultSort: 'startedAt',
    filterKeys: ['status', 'locationId'],
  });

  const columns = useMemo<ColumnDef<StockCountRow, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Session',
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.name}</p>
            <p className="truncate text-xs text-muted">{row.original.locationName}</p>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Statut',
        accessorKey: 'status',
        cell: ({ row }) => (
          <Badge tone={COUNT_STATUS_TONES[row.original.status] ?? 'neutral'}>
            {COUNT_STATUS_LABELS[row.original.status] ?? row.original.status}
          </Badge>
        ),
      },
      {
        id: 'progress',
        header: 'Avancement',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-sm">
            {row.original.countedCount} / {row.original.itemCount}
          </span>
        ),
      },
      {
        id: 'varianceUnits',
        header: 'Écart (unités)',
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className={
              row.original.varianceUnits === 0
                ? 'tabular-nums text-muted'
                : row.original.varianceUnits > 0
                  ? 'tabular-nums text-success'
                  : 'tabular-nums text-danger'
            }
          >
            {row.original.varianceUnits > 0
              ? `+${row.original.varianceUnits}`
              : row.original.varianceUnits}
          </span>
        ),
      },
      {
        id: 'varianceValue',
        header: 'Écart (valeur)',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatDa(row.original.varianceValueMinor)}</span>
        ),
      },
      {
        id: 'startedAt',
        header: 'Ouvert le',
        accessorKey: 'startedAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {dateFormatter.format(new Date(row.original.startedAt))}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Inventaires"
        description="Comptez le stock réel, comparez à l’attendu, appliquez les écarts."
        actions={
          <Button size="sm" onClick={() => setStarting(true)}>
            <Plus className="h-4 w-4" />
            Nouvel inventaire
          </Button>
        }
      />

      <DataTable<StockCountRow>
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
        onRowClick={(row) => navigate(`/inventory/counts/${row.id}`)}
        emptyTitle="Aucun inventaire"
        emptyDescription="Ouvrez une session pour compter le stock d’un emplacement."
        emptyAction={
          <Button size="sm" onClick={() => setStarting(true)}>
            <ClipboardList className="h-4 w-4" />
            Nouvel inventaire
          </Button>
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

      <StartCountDialog
        open={starting}
        onClose={() => setStarting(false)}
        onStarted={(id) => {
          setStarting(false);
          invalidate();
          navigate(`/inventory/counts/${id}`);
        }}
      />
    </div>
  );
}

function StartCountDialog({
  open,
  onClose,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const locations = useLocations();
  const categories = useCategoryTree();

  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'Tout l’emplacement' },
      ...flattenTree(categories.data ?? []).map((node) => ({
        value: node.id,
        label: `${'— '.repeat(node.depth)}${t(node.name, 'fr')}`,
      })),
    ],
    [categories.data],
  );

  if (open && !locationId && locations.data && locations.data.length > 0) {
    setLocationId((locations.data.find((location) => location.isDefault) ?? locations.data[0])!.id);
  }

  async function submit() {
    setBusy(true);
    try {
      const session = await inventory.startStockCount({
        locationId,
        name: name || `Inventaire ${new Date().toLocaleDateString('fr-DZ')}`,
        categoryId: categoryId || undefined,
        note: note || undefined,
      });
      notify.success(`Session ouverte : ${session.itemCount} référence(s) à compter`);
      onStarted(session.id);
    } catch (error) {
      notify.error(message(error, "L'ouverture a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvel inventaire</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Les quantités attendues sont figées à l’ouverture. Les ventes réalisées pendant le
            comptage restent prises en compte lors de l’application.
          </p>

          <Field label="Nom de la session">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Inventaire trimestriel — Alger"
            />
          </Field>

          <Field label="Emplacement" required>
            <Select
              value={locationId}
              onValueChange={setLocationId}
              options={(locations.data ?? []).map((location) => ({
                value: location.id,
                label: location.name,
              }))}
              placeholder="Choisir un emplacement"
            />
          </Field>

          <Field label="Limiter à une catégorie">
            <Select value={categoryId} onValueChange={setCategoryId} options={categoryOptions} />
          </Field>

          <Field label="Note">
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={!locationId} loading={busy}>
            Ouvrir la session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
