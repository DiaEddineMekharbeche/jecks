import { LEDGER_ACCOUNTS, LEDGER_KINDS, type LedgerAccount, type LedgerRow } from '@jecks/shared';
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
import { Banknote, Building2, Download, Plus, Truck, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { dateTimeFormatter, formatDa, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import * as finance from './api';

/**
 * The payments ledger — PRD F-AD-72.
 *
 * Every movement of money as a signed row: positive is in, negative is out. Balances
 * are the sum of the rows and are never stored, so a balance cannot drift away from the
 * entries that explain it.
 */

const ACCOUNT_LABELS: Record<LedgerAccount, string> = {
  cash: 'Caisse',
  bank: 'Banque',
  courier: 'Chez le transporteur',
  customer: 'Dû par les clients',
};

const ACCOUNT_ICONS: Record<LedgerAccount, typeof Banknote> = {
  cash: Banknote,
  bank: Building2,
  courier: Truck,
  customer: UserRound,
};

const KIND_LABELS: Record<string, string> = {
  sale: 'Vente',
  cod_collection: 'Encaissement COD',
  refund: 'Remboursement',
  expense: 'Dépense',
  settlement: 'Règlement transporteur',
  adjustment: 'Ajustement',
};

export function LedgerPage() {
  const [adding, setAdding] = useState(false);

  const table = useServerTable<LedgerRow>({
    module: 'ledger',
    endpoint: '/admin/finance/ledger',
    defaultSort: 'occurredAt',
    filterKeys: ['kind', 'account'],
  });

  const balances = useQuery({
    queryKey: ['admin', 'ledger-balances'],
    queryFn: finance.ledgerBalances,
    staleTime: 30_000,
  });

  const columns = useMemo<ColumnDef<LedgerRow, unknown>[]>(
    () => [
      {
        id: 'occurredAt',
        header: 'Date',
        accessorKey: 'occurredAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {dateTimeFormatter.format(new Date(row.original.occurredAt))}
          </span>
        ),
      },
      {
        id: 'kind',
        header: 'Type',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">{KIND_LABELS[row.original.kind] ?? row.original.kind}</span>
        ),
      },
      {
        id: 'account',
        header: 'Compte',
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone="neutral">{ACCOUNT_LABELS[row.original.account] ?? row.original.account}</Badge>
        ),
      },
      {
        id: 'orderNumber',
        header: 'Commande',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.orderNumber ? (
            <span className="font-mono text-xs">{row.original.orderNumber}</span>
          ) : (
            <span className="text-xs text-muted">—</span>
          ),
      },
      {
        id: 'note',
        header: 'Note',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="truncate text-xs text-muted">{row.original.note ?? ''}</span>
        ),
      },
      {
        id: 'amountMinor',
        header: 'Montant',
        enableSorting: false,
        cell: ({ row }) => {
          const amount = BigInt(row.original.amountMinor);
          return (
            <span
              className={cn(
                'tabular-nums',
                amount < 0n ? 'text-danger' : 'text-success',
              )}
            >
              {amount > 0n ? '+' : ''}
              {formatDa(row.original.amountMinor)}
            </span>
          );
        },
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Journal de caisse"
        description="Chaque mouvement d’argent, et où il se trouve."
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
                <DropdownMenuItem onSelect={() => void table.exportRows('csv')}>CSV</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void table.exportRows('xlsx')}>Excel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Écriture manuelle
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(balances.data?.accounts ?? []).map((entry) => {
          const Icon = ACCOUNT_ICONS[entry.account] ?? Banknote;
          const amount = BigInt(entry.balanceMinor);

          return (
            <div key={entry.account} className="rounded-lg border border-line bg-surface p-4">
              <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
                <Icon className="h-3.5 w-3.5" />
                {ACCOUNT_LABELS[entry.account]}
              </p>
              <p
                className={cn(
                  'mt-1 text-xl font-semibold tabular-nums',
                  amount < 0n && 'text-danger',
                )}
              >
                {formatDa(entry.balanceMinor)}
              </p>
              <p className="text-xs text-muted">{entry.entryCount} écriture(s)</p>
            </div>
          );
        })}
      </div>

      <DataTable<LedgerRow>
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
        emptyTitle="Aucune écriture"
        emptyDescription="Les encaissements et les règlements s’écrivent ici tout seuls."
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <MultiSelect
              options={LEDGER_KINDS.map((value) => ({ value, label: KIND_LABELS[value] ?? value }))}
              values={table.filters.kind ?? []}
              onValuesChange={(values) => table.setFilter('kind', values)}
              placeholder="Type"
            />
            <MultiSelect
              options={LEDGER_ACCOUNTS.map((value) => ({ value, label: ACCOUNT_LABELS[value] }))}
              values={table.filters.account ?? []}
              onValuesChange={(values) => table.setFilter('account', values)}
              placeholder="Compte"
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

      <EntryDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          table.refetch();
          void balances.refetch();
        }}
      />
    </div>
  );
}

/** For the movements no automatic hook can see: petrol taken out of the till. */
function EntryDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<string>('adjustment');
  const [account, setAccount] = useState<string>('cash');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState<bigint | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const signed = direction === 'out' ? -(amount ?? 0n) : (amount ?? 0n);
      await finance.createLedgerEntry({
        kind,
        account,
        amount: signed.toString(),
        note: note.trim() || null,
      });
      notify.success('Écriture enregistrée');
      onSaved();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Écriture manuelle</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select
                value={kind}
                onValueChange={setKind}
                options={LEDGER_KINDS.map((value) => ({ value, label: KIND_LABELS[value] ?? value }))}
              />
            </Field>
            <Field label="Compte">
              <Select
                value={account}
                onValueChange={setAccount}
                options={LEDGER_ACCOUNTS.map((value) => ({
                  value,
                  label: ACCOUNT_LABELS[value as LedgerAccount],
                }))}
              />
            </Field>
          </div>

          <Field label="Sens">
            <Select
              value={direction}
              onValueChange={(value) => setDirection(value as 'in' | 'out')}
              options={[
                { value: 'in', label: 'Entrée d’argent' },
                { value: 'out', label: 'Sortie d’argent' },
              ]}
            />
          </Field>

          <Field label="Montant" required>
            <MoneyInput value={amount ?? ''} onValueChange={setAmount} />
          </Field>

          <Field label="Note" hint="Pourquoi cette écriture existe.">
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!amount} onClick={() => void submit()}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
