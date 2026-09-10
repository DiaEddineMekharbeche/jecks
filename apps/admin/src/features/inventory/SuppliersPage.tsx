import type { SupplierInput, SupplierRow } from '@jecks/shared';
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
  SwitchField,
  TablePagination,
  Textarea,
  notify,
} from '@jecks/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { dateFormatter, formatDa, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import * as inventory from './api';
import { useInventoryInvalidate } from './queries';

/** Suppliers — PRD F-AD-52. */

const EMPTY: SupplierInput = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  note: '',
  active: true,
};

export function SuppliersPage() {
  const invalidate = useInventoryInvalidate();
  const [editing, setEditing] = useState<SupplierRow | 'new' | null>(null);
  const [confirming, setConfirming] = useState<SupplierRow | null>(null);
  const [busy, setBusy] = useState(false);

  const table = useServerTable<SupplierRow>({
    module: 'suppliers',
    endpoint: '/admin/suppliers',
    defaultSort: 'name',
    defaultOrder: 'asc',
    filterKeys: ['active'],
  });

  const columns = useMemo<ColumnDef<SupplierRow, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Fournisseur',
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.name}</p>
            <p className="truncate text-xs text-muted">{row.original.contactName ?? '—'}</p>
          </div>
        ),
      },
      {
        id: 'contact',
        header: 'Contact',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0 text-sm">
            {row.original.phone ? (
              <a href={`tel:${row.original.phone}`} className="block truncate hover:text-brass">
                {row.original.phone}
              </a>
            ) : null}
            {row.original.email ? (
              <a
                href={`mailto:${row.original.email}`}
                className="block truncate text-xs text-muted hover:text-brass"
              >
                {row.original.email}
              </a>
            ) : null}
            {!row.original.phone && !row.original.email ? <span className="text-muted">—</span> : null}
          </div>
        ),
      },
      {
        id: 'purchaseOrderCount',
        header: 'Commandes',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted">{row.original.purchaseOrderCount}</span>
        ),
      },
      {
        id: 'purchased',
        header: 'Total acheté',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatDa(row.original.purchasedMinor)}</span>
        ),
      },
      {
        id: 'lastOrderAt',
        header: 'Dernière commande',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {row.original.lastOrderAt
              ? dateFormatter.format(new Date(row.original.lastOrderAt))
              : '—'}
          </span>
        ),
      },
      {
        id: 'active',
        header: 'Statut',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.active ? (
            <Badge tone="success">Actif</Badge>
          ) : (
            <Badge tone="neutral">Inactif</Badge>
          ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(row.original)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  async function handleDelete() {
    if (!confirming) return;
    setBusy(true);
    try {
      await inventory.deleteSupplier(confirming.id);
      notify.success(`« ${confirming.name} » archivé`);
      setConfirming(null);
      invalidate();
    } catch (error) {
      notify.error(message(error, "L'archivage a échoué"));
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
        title="Fournisseurs"
        description="Qui vous approvisionne, combien vous lui avez acheté, et depuis quand."
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
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Nouveau fournisseur
            </Button>
          </>
        }
      />

      <DataTable<SupplierRow>
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
        onRowClick={(row) => setEditing(row)}
        emptyTitle="Aucun fournisseur"
        emptyDescription="Ajoutez vos fournisseurs pour pouvoir créer des commandes d’achat."
        emptyAction={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Nouveau fournisseur
          </Button>
        }
        toolbar={
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={table.search}
              onChange={(event) => table.setSearch(event.target.value)}
              placeholder="Nom, contact, téléphone"
              className="ps-9"
              aria-label="Rechercher un fournisseur"
            />
          </label>
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

      <SupplierDialog
        supplier={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          invalidate();
        }}
      />

      <Dialog open={Boolean(confirming)} onOpenChange={(open) => (open ? undefined : setConfirming(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archiver ce fournisseur ?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted">
              « {confirming?.name} » disparaîtra des listes. Son historique d’achats est conservé.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Annuler
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void handleDelete()}>
              Archiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SupplierDialog({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: SupplierRow | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = supplier === 'new';
  const [form, setForm] = useState<SupplierInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  // Seeding on render rather than in an effect keeps the dialog from flashing the
  // previous supplier's values for one frame when it reopens.
  const key = supplier === null ? null : isNew ? 'new' : supplier.id;
  if (key !== seeded) {
    setSeeded(key);
    setErrors({});
    setForm(
      supplier && supplier !== 'new'
        ? {
            name: supplier.name,
            contactName: supplier.contactName ?? '',
            phone: supplier.phone ?? '',
            email: supplier.email ?? '',
            address: supplier.address ?? '',
            note: supplier.note ?? '',
            active: supplier.active,
          }
        : EMPTY,
    );
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const payload: SupplierInput = { ...form, email: form.email || undefined };
      if (supplier === 'new') await inventory.createSupplier(payload);
      else if (supplier) await inventory.updateSupplier(supplier.id, payload);
      notify.success(isNew ? 'Fournisseur créé' : 'Fournisseur mis à jour');
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(supplier)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? 'Nouveau fournisseur' : 'Modifier le fournisseur'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom" required error={errors.name}>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Textile Import SARL"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact" error={errors.contactName}>
              <Input
                value={form.contactName ?? ''}
                onChange={(event) => setForm({ ...form, contactName: event.target.value })}
              />
            </Field>
            <Field label="Téléphone" error={errors.phone}>
              <Input
                value={form.phone ?? ''}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="0555 12 34 56"
              />
            </Field>
          </div>
          <Field label="E-mail" error={errors.email}>
            <Input
              type="email"
              value={form.email ?? ''}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label="Adresse" error={errors.address}>
            <Textarea
              rows={2}
              value={form.address ?? ''}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
            />
          </Field>
          <Field label="Note interne" error={errors.note}>
            <Textarea
              rows={2}
              value={form.note ?? ''}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              placeholder="Délai habituel, conditions de paiement…"
            />
          </Field>
          <SwitchField
            label="Actif"
            description="Un fournisseur inactif n’apparaît plus dans les sélecteurs."
            checked={form.active}
            onCheckedChange={(checked) => setForm({ ...form, active: checked })}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={!form.name.trim()} loading={busy}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
