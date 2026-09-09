'use client';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Select } from './inputs';

/**
 * Pagination bar for admin lists: page size, the visible range, and page controls.
 * Server-driven, so it only reports intent and never slices data itself.
 */
export interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
  /** Disables the controls while a page is in flight, so a double click cannot skip. */
  loading?: boolean;
}

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  className,
  loading = false,
}: TablePaginationProps) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 text-sm', className)}>
      <div className="flex items-center gap-3">
        <p className="text-muted tabular-nums">
          {total === 0 ? 'Aucun résultat' : `${first}–${last} sur ${total}`}
        </p>
        {onPageSizeChange ? (
          <label className="flex items-center gap-2 text-muted">
            <span className="sr-only sm:not-sr-only">Par page</span>
            <Select
              className="h-8 w-20"
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
              options={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
            />
          </label>
        ) : null}
      </div>

      <nav className="flex items-center gap-1" aria-label="Pagination">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Première page"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(1)}
        >
          <ChevronsLeft className="h-4 w-4 rtl:rotate-180" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Page précédente"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </Button>

        <span className="px-2 text-muted tabular-nums">
          {page} / {totalPages}
        </span>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Page suivante"
          disabled={page >= totalPages || loading}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dernière page"
          disabled={page >= totalPages || loading}
          onClick={() => onPageChange(totalPages)}
        >
          <ChevronsRight className="h-4 w-4 rtl:rotate-180" />
        </Button>
      </nav>
    </div>
  );
}
