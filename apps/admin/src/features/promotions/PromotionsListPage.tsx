import { PromotionType } from '@jecks/shared';
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
  Switch,
  TablePagination,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, FlaskConical, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dateFormatter, formatDa, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import * as promotions from './api';
import type { PromotionRow } from './api';
import { PROMOTION_STATE_LABELS, PROMOTION_STATE_TONES, PROMOTION_TYPE_LABELS } from './labels';

/**
 * Promotions list — PRD F-AD-20.
 *
 * The column that matters is what each promotion has actually given away. A discount
 * looks free until it is added up, and this is the only screen that adds it up.
 */

const STATE_TABS = [
  { value: 'ALL', label: 'Toutes' },
  { value: 'active', label: 'En cours' },
  { value: 'scheduled', label: 'Programmées' },
  { value: 'expired', label: 'Terminées' },
  { value: 'draft', label: 'Inactives' },
];

export function PromotionsListPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const table = useServerTable<PromotionRow>({
    module: 'promotions',
    endpoint: '/admin/promotions',
    defaultSort: 'createdAt',
    filterKeys: ['state', 'type'],
  });

  const { data: counts = {} } = useQuery({
    queryKey: ['admin', 'promotions', 'counts'],
    queryFn: promotions.getPromotionCounts,
    staleTime: 30_000,
  });

  const activeState = table.filters.state ?? [];

  async function toggle(row: PromotionRow) {
    setBusy(row.id);
    try {
      await promotions.setPromotionActive(row.id, !row.active);
      notify.success(row.active ? `« ${row.name} » désactivée` : `« ${row.name} » activée`);
      table.refetch();
    } catch (error) {
      notify.error(message(error, 'La mise à jour a échoué'));
    } finally {
      setBusy(null);
    }
  }

  const columns = useMemo<ColumnDef<PromotionRow, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Promotion',
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.name}</p>
            <p className="truncate text-xs text-muted">
              {row.original.code ? (
                <span className="font-mono">{row.original.code}</span>
              ) : row.original.codeCount > 0 ? (
                `${row.original.codeCount} codes uniques`
              ) : (
                'automatique'
              )}
            </p>
          </div>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm">
              {PROMOTION_TYPE_LABELS[row.original.type] ?? row.original.type}
            </p>
            <p className="text-xs text-muted">{describeValue(row.original)}</p>
          </div>
        ),
      },
      {
        id: 'state',
        header: 'État',
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone={PROMOTION_STATE_TONES[row.original.state] ?? 'neutral'}>
            {PROMOTION_STATE_LABELS[row.original.state] ?? row.original.state}
          </Badge>
        ),
      },
      {
        id: 'usageCount',
        header: 'Utilisations',
        accessorKey: 'usageCount',
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.usageCount}
            {row.original.usageLimitTotal !== null ? (
              <span className="text-muted"> / {row.original.usageLimitTotal}</span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'granted',
        header: 'Remise accordée',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatDa(row.original.grantedMinor)}</span>
        ),
      },
      {
        id: 'window',
        header: 'Période',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {row.original.startsAt
              ? dateFormatter.format(new Date(row.original.startsAt))
              : 'toujours'}
            {row.original.endsAt
              ? ` → ${dateFormatter.format(new Date(row.original.endsAt))}`
              : ''}
          </span>
        ),
      },
      {
        id: 'priority',
        header: 'Priorité',
        accessorKey: 'priority',
        cell: ({ row }) => (
          <span className="tabular-nums text-muted">
            {row.original.priority}
            {row.original.stackable ? (
              <span className="ms-1 text-[10px] uppercase text-brass">cumulable</span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'active',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div
            className="flex justify-end"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <Switch
              checked={row.original.active}
              disabled={busy === row.original.id}
              onCheckedChange={() => void toggle(row.original)}
              aria-label={row.original.active ? 'Désactiver' : 'Activer'}
            />
          </div>
        ),
      },
    ],
    // `toggle` is stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy],
  );

  async function handleExport(format: 'csv' | 'xlsx') {
    try {
      await table.exportRows(format);
      notify.success(`Export ${format.toUpperCase()} téléchargé`);
    } catch (error) {
      notify.error(message(error, "L'export a échoué"));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Promotions"
        description="Codes, remises automatiques et ce qu’elles ont réellement coûté."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/promotions/simulator')}>
              <FlaskConical className="h-4 w-4" />
              Simulateur
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
                <DropdownMenuItem onSelect={() => void handleExport('xlsx')}>Excel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => navigate('/promotions/new')}>
              <Plus className="h-4 w-4" />
              Nouvelle promotion
            </Button>
          </>
        }
      />

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

      <DataTable<PromotionRow>
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
        onRowClick={(row) => navigate(`/promotions/${row.id}`)}
        emptyTitle="Aucune promotion"
        emptyDescription="Créez un code de bienvenue ou une remise automatique."
        emptyAction={
          <Button size="sm" onClick={() => navigate('/promotions/new')}>
            <Plus className="h-4 w-4" />
            Nouvelle promotion
          </Button>
        }
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={table.search}
                onChange={(event) => table.setSearch(event.target.value)}
                placeholder="Nom ou code"
                className="ps-9"
                aria-label="Rechercher une promotion"
              />
            </label>
            <MultiSelect
              options={Object.values(PromotionType).map((type) => ({
                value: type,
                label: PROMOTION_TYPE_LABELS[type] ?? type,
              }))}
              values={table.filters.type ?? []}
              onValuesChange={(values) => table.setFilter('type', values)}
              placeholder="Type"
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
    </div>
  );
}

/** The value in one phrase, so the list reads without opening anything. */
function describeValue(row: PromotionRow): string {
  if (row.percentOff !== null) return `-${row.percentOff} %`;
  if (row.amountOffMinor) return `-${formatDa(row.amountOffMinor)}`;
  if (row.type === PromotionType.FREE_SHIPPING) return 'livraison offerte';
  return '—';
}
