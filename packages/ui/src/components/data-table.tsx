'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Rows3 } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Checkbox } from './inputs';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './overlay';
import { EmptyState, Skeleton } from './surface';

/**
 * Server-driven table. Sorting, pagination and filtering all happen in Postgres; this
 * component never sorts or slices rows itself, because an admin list can hold 100k
 * orders and the browser must only ever hold one page of them.
 *
 * Everything it owns is presentation: column visibility, density, selection and the
 * bulk-action bar. State that belongs in the URL is passed in and pushed back out, so
 * a filtered list is a shareable link.
 */

export type TableDensity = 'comfortable' | 'compact';

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Stable row id, used for selection across pages. */
  getRowId: (row: TData) => string;

  loading?: boolean;
  error?: ReactNode;
  onRetry?: () => void;

  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;

  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;

  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;

  density?: TableDensity;
  onDensityChange?: (density: TableDensity) => void;

  onRowClick?: (row: TData) => void;

  /** Rendered above the table when at least one row is selected. */
  bulkActions?: (selectedIds: string[], clear: () => void) => ReactNode;

  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;

  /** Rendered in the toolbar, before the column and density menus. */
  toolbar?: ReactNode;

  /** Skeleton rows while the first page loads. */
  skeletonRows?: number;
  className?: string;
}

export function DataTable<TData>({
  columns,
  data,
  getRowId,
  loading = false,
  error,
  onRetry,
  sorting = [],
  onSortingChange,
  rowSelection = {},
  onRowSelectionChange,
  columnVisibility = {},
  onColumnVisibilityChange,
  density = 'comfortable',
  onDensityChange,
  onRowClick,
  bulkActions,
  emptyTitle = 'Aucun résultat',
  emptyDescription,
  emptyAction,
  toolbar,
  skeletonRows = 8,
  className,
}: DataTableProps<TData>) {
  const selectable = Boolean(onRowSelectionChange);

  const allColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
    if (!selectable) return columns;
    return [selectionColumn<TData>(), ...columns];
  }, [columns, selectable]);

  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId,
    state: { sorting, rowSelection, columnVisibility },
    onSortingChange,
    onRowSelectionChange,
    onColumnVisibilityChange,
    getCoreRowModel: getCoreRowModel(),
    // The server already did this work; doing it again here would fight it.
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    enableRowSelection: selectable,
  });

  const selectedIds = Object.entries(rowSelection)
    .filter(([, isSelected]) => isSelected)
    .map(([id]) => id);

  const cellPadding = density === 'compact' ? 'px-3 py-1.5' : 'px-3 py-3';
  const hideable = table.getAllLeafColumns().filter((column) => column.getCanHide() && column.id !== 'select');

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <div className="ms-auto flex items-center gap-2">
          {onDensityChange ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Densité">
                  <Rows3 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Densité</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={density}
                  onValueChange={(value) => onDensityChange(value as TableDensity)}
                >
                  <DropdownMenuRadioItem value="comfortable">Confortable</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="compact">Compacte</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {onColumnVisibilityChange && hideable.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Colonnes">
                  <Columns3 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                <DropdownMenuLabel>Colonnes</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {hideable.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(checked) => column.toggleVisibility(Boolean(checked))}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {headerLabel(column.columnDef.header) ?? column.id}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {selectedIds.length > 0 && bulkActions ? (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-brass/40 bg-brass/10 px-3 py-2">
          <span className="text-sm font-medium text-brass">
            {selectedIds.length} sélectionné{selectedIds.length > 1 ? 's' : ''}
          </span>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {bulkActions(selectedIds, () => onRowSelectionChange?.({}))}
            <Button variant="ghost" size="sm" onClick={() => onRowSelectionChange?.({})}>
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-sm border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-elevated">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort() && Boolean(onSortingChange);
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      style={{ width: header.getSize() === 150 ? undefined : header.getSize() }}
                      className={cn(
                        'whitespace-nowrap border-b border-line text-start text-xs font-semibold uppercase tracking-wider text-muted',
                        cellPadding,
                      )}
                      aria-sort={
                        sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                      }
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex items-center gap-1 transition-colors hover:text-ink"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {loading && data.length === 0
              ? Array.from({ length: skeletonRows }, (_, rowIndex) => (
                  <tr key={`skeleton-${rowIndex}`} className="border-b border-line last:border-0">
                    {table.getVisibleLeafColumns().map((column) => (
                      <td key={column.id} className={cellPadding}>
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={cn(
                      'border-b border-line transition-colors last:border-0',
                      onRowClick && 'cursor-pointer hover:bg-elevated',
                      row.getIsSelected() && 'bg-brass/5',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={cn('align-middle', cellPadding)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>

        {!loading && data.length === 0 && !error ? (
          <EmptyState
            className="rounded-none border-0"
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
          />
        ) : null}

        {error ? (
          <EmptyState
            className="rounded-none border-0"
            title="Impossible de charger la liste"
            description={error}
            action={
              onRetry ? (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Réessayer
                </Button>
              ) : null
            }
          />
        ) : null}
      </div>
    </div>
  );
}

/** Checkbox column, prepended whenever the caller opts into selection. */
function selectionColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: 'select',
    size: 40,
    enableSorting: false,
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="Tout sélectionner"
        checked={
          table.getIsAllRowsSelected()
            ? true
            : table.getIsSomeRowsSelected()
              ? 'indeterminate'
              : false
        }
        onCheckedChange={(checked) => table.toggleAllRowsSelected(Boolean(checked))}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label="Sélectionner la ligne"
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
        // Selecting must not also open the row.
        onClick={(event) => event.stopPropagation()}
      />
    ),
  };
}

/** Column menus need a string; a header can be a render function. */
function headerLabel(header: unknown): string | null {
  return typeof header === 'string' ? header : null;
}
