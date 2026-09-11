import {
  EXPENSE_RECURRENCES,
  t,
  type ExpenseCategoryDto,
  type ExpenseRow,
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
  MoneyInput,
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
import { Download, Plus, RefreshCw, Search, Tags, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { dateFormatter, formatDa, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import * as finance from './api';

/**
 * Expenses — PRD F-AD-71.
 *
 * Everything that is not the cost of a cap. A recurring expense is entered once and
 * generated forward, so changing the rent changes the future without rewriting history.
 */

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: 'Hebdomadaire',
  monthly: 'Mensuelle',
  yearly: 'Annuelle',
};

export function ExpensesPage() {
  const [editing, setEditing] = useState<ExpenseRow | 'new' | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const table = useServerTable<ExpenseRow>({
    module: 'expenses',
    endpoint: '/admin/finance/expenses',
    defaultSort: 'incurredAt',
    filterKeys: ['categoryId', 'recurrence'],
  });

  const categories = useQuery({
    queryKey: ['admin', 'expense-categories'],
    queryFn: finance.listCategories,
    staleTime: 300_000,
  });

  // The API returns the filtered total in `meta`; the list is also an answer.
  const totalMinor = table.extraMeta.totalAmountMinor as string | undefined;

  async function remove(row: ExpenseRow) {
    if (!window.confirm(`Supprimer « ${row.label} » ?`)) return;
    try {
      await finance.deleteExpense(row.id);
      notify.success('Dépense supprimée');
      table.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  async function generate() {
    setBusy(true);
    try {
      const result = await finance.generateRecurring();
      notify.success(
        result.created > 0
          ? `${result.created} échéance(s) générées`
          : 'Tout est déjà à jour',
      );
      table.refetch();
    } catch (error) {
      notify.error(message(error, 'La génération a échoué'));
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo<ColumnDef<ExpenseRow, unknown>[]>(
    () => [
      {
        id: 'incurredAt',
        header: 'Date',
        accessorKey: 'incurredAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm">
            {dateFormatter.format(new Date(row.original.incurredAt))}
          </span>
        ),
      },
      {
        id: 'label',
        header: 'Libellé',
        accessorKey: 'label',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.label}</p>
            {row.original.note ? (
              <p className="truncate text-xs text-muted">{row.original.note}</p>
            ) : null}
          </div>
        ),
      },
      {
        id: 'category',
        header: 'Catégorie',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.categoryName ? (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: row.original.categoryColor ?? 'var(--color-muted)' }}
              />
              {t(row.original.categoryName, 'fr')}
            </span>
          ) : (
            <span className="text-xs text-muted">non classée</span>
          ),
      },
      {
        id: 'recurrence',
        header: 'Récurrence',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.recurrence ? (
            <Badge tone="info">{RECURRENCE_LABELS[row.original.recurrence]}</Badge>
          ) : row.original.parentId ? (
            <span className="text-xs text-muted">échéance</span>
          ) : (
            <span className="text-xs text-muted">ponctuelle</span>
          ),
      },
      {
        id: 'amountMinor',
        header: 'Montant',
        accessorKey: 'amountMinor',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatDa(row.original.amountMinor)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div
            className="flex justify-end gap-1"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)}>
              Modifier
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Supprimer ${row.original.label}`}
              onClick={() => void remove(row.original)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Dépenses"
        description="Le loyer, les salaires, l’emballage : tout ce qui n’est pas le coût d’une casquette."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setCategoriesOpen(true)}>
              <Tags className="h-4 w-4" />
              Catégories
            </Button>
            <Button variant="outline" size="sm" loading={busy} onClick={() => void generate()}>
              <RefreshCw className="h-4 w-4" />
              Générer les échéances
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
                <DropdownMenuItem onSelect={() => void table.exportRows('csv')}>CSV</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void table.exportRows('xlsx')}>Excel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Nouvelle dépense
            </Button>
          </>
        }
      />

      {totalMinor ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-xs uppercase tracking-wider text-muted">Total filtré</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatDa(totalMinor)}</p>
          <p className="text-xs text-muted">{table.total} ligne(s)</p>
        </div>
      ) : null}

      <DataTable<ExpenseRow>
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
        emptyTitle="Aucune dépense"
        emptyDescription="Commencez par le loyer et les salaires : ce sont eux qui décident du résultat."
        emptyAction={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Nouvelle dépense
          </Button>
        }
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <label className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={table.search}
                onChange={(event) => table.setSearch(event.target.value)}
                placeholder="Libellé"
                className="ps-9"
                aria-label="Rechercher une dépense"
              />
            </label>
            <MultiSelect
              options={(categories.data ?? []).map((category) => ({
                value: category.id,
                label: t(category.name, 'fr'),
              }))}
              values={table.filters.categoryId ?? []}
              onValuesChange={(values) => table.setFilter('categoryId', values)}
              placeholder="Catégorie"
            />
            <MultiSelect
              options={[
                { value: 'none', label: 'Ponctuelle' },
                ...EXPENSE_RECURRENCES.map((value) => ({
                  value,
                  label: RECURRENCE_LABELS[value] ?? value,
                })),
              ]}
              values={table.filters.recurrence ?? []}
              onValuesChange={(values) => table.setFilter('recurrence', values)}
              placeholder="Récurrence"
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

      {editing ? (
        <ExpenseDialog
          expense={editing === 'new' ? null : editing}
          categories={categories.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            table.refetch();
          }}
        />
      ) : null}

      <CategoriesDialog
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        onChanged={() => void categories.refetch()}
      />
    </div>
  );
}

function ExpenseDialog({
  expense,
  categories,
  onClose,
  onSaved,
}: {
  expense: ExpenseRow | null;
  categories: ExpenseCategoryDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(expense?.label ?? '');
  const [amount, setAmount] = useState<bigint | null>(
    expense ? BigInt(expense.amountMinor) : null,
  );
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? '');
  const [incurredAt, setIncurredAt] = useState(
    expense?.incurredAt ?? new Date().toISOString().slice(0, 10),
  );
  const [recurrence, setRecurrence] = useState(expense?.recurrence ?? '');
  const [recurrenceEndsAt, setRecurrenceEndsAt] = useState(expense?.recurrenceEndsAt ?? '');
  const [note, setNote] = useState(expense?.note ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        label: label.trim(),
        amount: (amount ?? 0n).toString(),
        categoryId: categoryId || null,
        incurredAt,
        recurrence: recurrence || null,
        recurrenceEndsAt: recurrenceEndsAt || null,
        note: note.trim() || null,
      };

      if (expense) await finance.updateExpense(expense.id, payload);
      else await finance.createExpense(payload);

      notify.success(expense ? 'Dépense mise à jour' : 'Dépense enregistrée');
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{expense ? 'Modifier la dépense' : 'Nouvelle dépense'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Libellé" required error={errors.label}>
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Loyer atelier"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Montant" required error={errors.amount}>
              <MoneyInput value={amount ?? ''} onValueChange={setAmount} />
            </Field>
            <Field label="Date" required>
              <Input
                type="date"
                value={incurredAt}
                onChange={(event) => setIncurredAt(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Catégorie">
            <Select
              value={categoryId}
              onValueChange={setCategoryId}
              options={[
                { value: '', label: 'Non classée' },
                ...categories.map((category) => ({
                  value: category.id,
                  label: t(category.name, 'fr'),
                })),
              ]}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Récurrence"
              hint="Une dépense récurrente est générée en avant, mois après mois."
            >
              <Select
                value={recurrence}
                onValueChange={setRecurrence}
                options={[
                  { value: '', label: 'Ponctuelle' },
                  ...EXPENSE_RECURRENCES.map((value) => ({
                    value,
                    label: RECURRENCE_LABELS[value] ?? value,
                  })),
                ]}
              />
            </Field>
            {recurrence ? (
              <Field label="Jusqu’au" error={errors.recurrenceEndsAt}>
                <Input
                  type="date"
                  value={recurrenceEndsAt}
                  onChange={(event) => setRecurrenceEndsAt(event.target.value)}
                />
              </Field>
            ) : null}
          </div>

          <Field label="Note">
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!label.trim() || !amount} onClick={() => void submit()}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const categories = useQuery({
    queryKey: ['admin', 'expense-categories'],
    queryFn: finance.listCategories,
    enabled: open,
  });

  const [name, setName] = useState('');
  const [color, setColor] = useState('#B8860B');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await finance.createCategory({
        name: { fr: name.trim() },
        slug: slugify(name),
        color,
      });
      notify.success('Catégorie créée');
      setName('');
      await categories.refetch();
      onChanged();
    } catch (error) {
      notify.error(message(error, 'La création a échoué'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(category: ExpenseCategoryDto) {
    if (!window.confirm(`Supprimer « ${t(category.name, 'fr')} » ?`)) return;
    try {
      await finance.deleteCategory(category.id);
      notify.success('Catégorie supprimée');
      await categories.refetch();
      onChanged();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catégories de dépenses</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <Field label="Nouvelle catégorie" className="flex-1">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Maintenance"
              />
            </Field>
            <Field label="Couleur" className="w-24">
              <Input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-10 p-1"
              />
            </Field>
            <Button loading={busy} disabled={!name.trim()} onClick={() => void create()}>
              Ajouter
            </Button>
          </div>

          <ul className="divide-y divide-line rounded-md border border-line">
            {(categories.data ?? []).map((category) => (
              <li key={category.id} className="flex items-center gap-3 px-3 py-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: category.color ?? 'var(--color-muted)' }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t(category.name, 'fr')}</p>
                  <p className="text-xs text-muted">
                    {category.expenseCount} dépense(s) · {formatDa(category.totalMinor)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Supprimer"
                  className={cn(category.expenseCount > 0 && 'opacity-50')}
                  onClick={() => void remove(category)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}
