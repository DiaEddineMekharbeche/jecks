import { t, type CustomerRow } from '@jecks/shared';
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
  TablePagination,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, Merge, Plus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '@/lib/api';
import { dateFormatter, formatDa, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import * as customers from './api';
import { SEGMENT_LABELS, SEGMENT_TONES } from './labels';

/**
 * Customers — PRD F-AD-40.
 *
 * The column a cash-on-delivery shop reads first is reliability: how often this person
 * actually takes the parcel. It decides whether the next order gets confirmed by phone
 * or shipped on sight.
 */
export function CustomersListPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [merging, setMerging] = useState(false);

  const table = useServerTable<CustomerRow>({
    module: 'customers',
    endpoint: '/admin/customers',
    defaultSort: 'createdAt',
    filterKeys: ['segment', 'groupId', 'blacklisted'],
  });

  const summary = useQuery({
    queryKey: ['admin', 'customer-segments'],
    queryFn: customers.segments,
    staleTime: 60_000,
  });

  const groups = useQuery({
    queryKey: ['admin', 'customer-groups'],
    queryFn: customers.listGroups,
    staleTime: 300_000,
  });

  const activeSegment = table.filters.segment ?? [];

  const columns = useMemo<ColumnDef<CustomerRow, unknown>[]>(
    () => [
      {
        id: 'fullName',
        header: 'Client',
        accessorKey: 'fullName',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.fullName}</p>
            <p className="truncate font-mono text-xs text-muted">{row.original.phone}</p>
          </div>
        ),
      },
      {
        id: 'segment',
        header: 'Segment',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <Badge tone={SEGMENT_TONES[row.original.segment] ?? 'neutral'}>
              {SEGMENT_LABELS[row.original.segment] ?? row.original.segment}
            </Badge>
            {row.original.groupName ? (
              <span className="text-[11px] text-muted">{t(row.original.groupName, 'fr')}</span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'ordersCount',
        header: 'Commandes',
        accessorKey: 'ordersCount',
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.deliveredCount}
            <span className="text-muted"> / {row.original.ordersCount}</span>
          </span>
        ),
      },
      {
        id: 'reliability',
        header: 'Fiabilité',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.reliability === null ? (
            <span className="text-xs text-muted">—</span>
          ) : (
            <span
              className={cn(
                'tabular-nums',
                row.original.reliability < 60 && 'text-danger',
                row.original.reliability >= 90 && 'text-success',
              )}
            >
              {row.original.reliability} %
            </span>
          ),
      },
      {
        id: 'lifetimeValue',
        header: 'Valeur vie',
        accessorKey: 'lifetimeValue',
        cell: ({ row }) => (
          <div className="text-end">
            <p className="tabular-nums">{formatDa(row.original.lifetimeValueMinor)}</p>
            <p className="text-[11px] text-muted">
              {formatDa(row.original.averageOrderMinor)} / commande
            </p>
          </div>
        ),
      },
      {
        id: 'loyaltyPoints',
        header: 'Points',
        accessorKey: 'loyaltyPoints',
        cell: ({ row }) => (
          <span className="tabular-nums text-muted">{row.original.loyaltyPoints}</span>
        ),
      },
      {
        id: 'lastOrderAt',
        header: 'Dernière commande',
        accessorKey: 'lastOrderAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {row.original.lastOrderAt
              ? dateFormatter.format(new Date(row.original.lastOrderAt))
              : 'jamais'}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Clients"
        description="Qui achète, qui revient, et qui prend vraiment son colis."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setMerging(true)}>
              <Merge className="h-4 w-4" />
              Fusionner
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
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Nouveau client
            </Button>
          </>
        }
      />

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max items-center gap-1 border-b border-line">
          <SegmentTab
            label="Tous"
            count={(summary.data ?? []).reduce((sum, entry) => sum + entry.count, 0)}
            selected={activeSegment.length === 0}
            onSelect={() => table.setFilter('segment', [])}
          />
          {(summary.data ?? []).map((entry) => (
            <SegmentTab
              key={entry.segment}
              label={SEGMENT_LABELS[entry.segment] ?? entry.segment}
              count={entry.count}
              hint={formatDa(entry.lifetimeValueMinor)}
              selected={activeSegment.includes(entry.segment)}
              onSelect={() =>
                table.setFilter(
                  'segment',
                  activeSegment.includes(entry.segment) ? [] : [entry.segment],
                )
              }
            />
          ))}
        </div>
      </div>

      <DataTable<CustomerRow>
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
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        emptyTitle="Aucun client"
        emptyDescription="Un client est créé automatiquement à la première commande."
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={table.search}
                onChange={(event) => table.setSearch(event.target.value)}
                placeholder="Téléphone, nom ou e-mail"
                className="ps-9"
                aria-label="Rechercher un client"
              />
            </label>
            <MultiSelect
              options={(groups.data ?? []).map((group) => ({
                value: group.id,
                label: t(group.name, 'fr'),
              }))}
              values={table.filters.groupId ?? []}
              onValuesChange={(values) => table.setFilter('groupId', values)}
              placeholder="Groupe"
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

      <CreateDialog
        open={creating}
        groups={groups.data ?? []}
        onClose={() => setCreating(false)}
        onCreated={(id) => navigate(`/customers/${id}`)}
      />

      <MergeDialog open={merging} onClose={() => setMerging(false)} onMerged={() => table.refetch()} />
    </div>
  );
}

function SegmentTab({
  label,
  count,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'relative flex flex-col items-start gap-0.5 whitespace-nowrap px-3 py-2 text-sm transition-colors',
        selected
          ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brass'
          : 'text-muted hover:text-ink',
      )}
    >
      <span className="flex items-center gap-1.5">
        {label}
        <span className="text-xs tabular-nums opacity-70">{count}</span>
      </span>
      {hint ? <span className="text-[11px] opacity-60">{hint}</span> : null}
    </button>
  );
}

function CreateDialog({
  open,
  groups,
  onClose,
  onCreated,
}: {
  open: boolean;
  groups: Array<{ id: string; name: Record<string, string> }>;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [groupId, setGroupId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const customer = await customers.createCustomer({
        phone: phone.trim(),
        fullName: fullName.trim(),
        email: email.trim() || null,
        groupId: groupId || null,
        acceptsMarketing: false,
      });
      notify.success('Client créé');
      onCreated(customer.id);
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, 'La création a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau client</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field
            label="Téléphone"
            required
            hint="C’est l’identité du client : un numéro, une fiche."
            error={errors.phone}
          >
            <Input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="0551 23 45 67"
            />
          </Field>

          <Field label="Nom complet" required error={errors.fullName}>
            <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </Field>

          <Field label="E-mail" error={errors.email}>
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>

          <Field label="Groupe">
            <Select
              value={groupId}
              onValueChange={setGroupId}
              options={[
                { value: '', label: 'Aucun' },
                ...groups.map((group) => ({ value: group.id, label: t(group.name, 'fr') })),
              ]}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={!phone.trim() || !fullName.trim()}
            onClick={() => void submit()}
          >
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Merging two records of the same person — PRD F-AD-42.
 *
 * The preview is not decoration: the operation cannot be undone, and an operator should
 * see how many orders are about to move before they agree to it.
 */
function MergeDialog({
  open,
  onClose,
  onMerged,
}: {
  open: boolean;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [keepId, setKeepId] = useState('');
  const [mergeId, setMergeId] = useState('');
  const [busy, setBusy] = useState(false);

  const preview = useQuery({
    queryKey: ['admin', 'merge-preview', keepId, mergeId],
    queryFn: () => customers.mergePreview(keepId, mergeId),
    enabled: open && keepId.length > 10 && mergeId.length > 10,
    retry: false,
  });

  async function submit() {
    setBusy(true);
    try {
      await customers.merge({ keepId, mergeId });
      notify.success('Fiches fusionnées');
      onMerged();
      onClose();
    } catch (error) {
      notify.error(message(error, 'La fusion a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fusionner deux fiches</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Tout passe sur la fiche conservée : commandes, adresses, notes, avis et points. La
            seconde est archivée, jamais supprimée.
          </p>

          <Field label="Fiche à conserver" hint="Son identifiant, depuis l’URL de sa page.">
            <Input
              value={keepId}
              onChange={(event) => setKeepId(event.target.value.trim())}
              className="font-mono text-xs"
            />
          </Field>

          <Field label="Fiche à fusionner">
            <Input
              value={mergeId}
              onChange={(event) => setMergeId(event.target.value.trim())}
              className="font-mono text-xs"
            />
          </Field>

          {preview.data ? (
            <div className="rounded-md border border-line p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <Users className="h-4 w-4 text-brass" />
                {preview.data.merge.fullName} → {preview.data.keep.fullName}
              </p>
              <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
                <li>{preview.data.moves.orders} commande(s)</li>
                <li>{preview.data.moves.addresses} adresse(s)</li>
                <li>{preview.data.moves.notes} note(s)</li>
                <li>{preview.data.moves.reviews} avis</li>
                <li>{preview.data.moves.loyaltyPoints} point(s) de fidélité</li>
              </ul>
            </div>
          ) : preview.error ? (
            <p className="text-sm text-danger">{(preview.error as Error).message}</p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!preview.data}
            onClick={() => void submit()}
          >
            Fusionner définitivement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
