import type { AdminListResponse, SavedView, SavedViewState } from '@jecks/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RowSelectionState, SortingState, VisibilityState } from '@tanstack/react-table';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, apiWithMeta, applyQuery, getAccessToken, type QueryParams } from './api';

/**
 * The list framework every admin module uses — PRD-COMPLETION Section 2.
 *
 * List state lives in the URL, not in component state. That single decision is what
 * makes a filtered list shareable, bookmarkable, survivable across a reload, and
 * restorable from a saved view without any extra plumbing.
 *
 * What stays in React state is presentation the URL has no business carrying: which
 * rows are ticked, and how dense the table is.
 */

export interface ServerTableOptions {
  /** Kebab-case key: "orders", "products". Namespaces saved views and query keys. */
  module: string;
  /** API path, e.g. `/admin/orders`. */
  endpoint: string;
  defaultSort: string;
  defaultOrder?: 'asc' | 'desc';
  defaultPageSize?: number;
  /** Filter names this list understands; anything else in the URL is ignored. */
  filterKeys?: string[];
  /** Columns hidden until the user turns them on. */
  defaultHiddenColumns?: string[];
  enabled?: boolean;
}

export interface ServerTable<TRow> {
  rows: TRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;

  loading: boolean;
  fetching: boolean;
  error: Error | null;
  refetch: () => void;

  search: string;
  setSearch: (value: string) => void;

  filters: Record<string, string[]>;
  setFilter: (key: string, values: string[]) => void;
  toggleFilter: (key: string, value: string) => void;
  clearFilters: () => void;
  activeFilterCount: number;

  sorting: SortingState;
  setSorting: (updater: SortingState | ((old: SortingState) => SortingState)) => void;

  setPage: (page: number) => void;
  setPageSize: (size: number) => void;

  rowSelection: RowSelectionState;
  setRowSelection: (
    updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState),
  ) => void;
  selectedIds: string[];
  clearSelection: () => void;

  columnVisibility: VisibilityState;
  setColumnVisibility: (
    updater: VisibilityState | ((old: VisibilityState) => VisibilityState),
  ) => void;

  density: 'comfortable' | 'compact';
  setDensity: (density: 'comfortable' | 'compact') => void;

  /** Current state, in the shape a saved view stores. */
  snapshot: () => SavedViewState;
  applyView: (view: SavedView) => void;

  exportRows: (format: 'csv' | 'xlsx') => Promise<void>;
  queryKey: unknown[];
}

export function useServerTable<TRow>(options: ServerTableOptions): ServerTable<TRow> {
  const {
    module,
    endpoint,
    defaultSort,
    defaultOrder = 'desc',
    defaultPageSize = 50,
    filterKeys = [],
    defaultHiddenColumns = [],
    enabled = true,
  } = options;

  // Joined once so the memo below has a primitive dependency ESLint can verify.
  const filterKeysSignature = filterKeys.join(',');

  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(defaultHiddenColumns.map((column) => [column, false])),
  );

  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('pageSize') ?? defaultPageSize);
  const sort = params.get('sort') ?? defaultSort;
  const order = (params.get('order') as 'asc' | 'desc' | null) ?? defaultOrder;
  const search = params.get('q') ?? '';

  const filters = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const key of filterKeys) {
      const values = params.getAll(`filter[${key}]`);
      if (values.length > 0) out[key] = values;
    }
    return out;
    // `filterKeys` is a fresh array literal on every render, so the memo keys off its
    // joined signature instead; `params` is stable enough for React Router's purposes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, filterKeysSignature]);

  /** Writes URL state, resetting to page 1 whenever the result set changes shape. */
  const patchParams = useCallback(
    (mutate: (next: URLSearchParams) => void, resetPage = true) => {
      const next = new URLSearchParams(params);
      mutate(next);
      if (resetPage) next.delete('page');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const queryParams = useMemo<QueryParams>(() => {
    const out: QueryParams = {
      page,
      pageSize,
      sort,
      order,
    };
    if (search) out.q = search;
    for (const [key, values] of Object.entries(filters)) out[`filter[${key}]`] = values;
    return out;
  }, [page, pageSize, sort, order, search, filters]);

  const queryKey = useMemo(() => ['admin', module, queryParams], [module, queryParams]);

  const query = useQuery({
    queryKey,
    enabled,
    // Keeps the previous page on screen while the next one loads, so the table does
    // not collapse to skeletons on every keystroke or page change.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<AdminListResponse<TRow>> => {
      const result = await apiWithMeta<TRow[]>(endpoint, { query: queryParams });
      return {
        data: result.data ?? [],
        // The API always sends list meta; defaulting keeps a malformed response from
        // rendering NaN in the pagination bar.
        meta: {
          page: Number(result.meta?.page ?? 1),
          pageSize: Number(result.meta?.pageSize ?? defaultPageSize),
          total: Number(result.meta?.total ?? 0),
          totalPages: Number(result.meta?.totalPages ?? 1),
        },
      };
    },
  });

  const meta = query.data?.meta;

  const selectedIds = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, selected]) => selected)
        .map(([id]) => id),
    [rowSelection],
  );

  const snapshot = useCallback(
    (): SavedViewState => ({
      filters,
      sort,
      order,
      pageSize,
      q: search || undefined,
      columns: columnVisibility,
      density,
    }),
    [filters, sort, order, pageSize, search, columnVisibility, density],
  );

  const applyView = useCallback(
    (view: SavedView) => {
      const next = new URLSearchParams();
      for (const [key, values] of Object.entries(view.state.filters ?? {})) {
        for (const value of Array.isArray(values) ? values : [values]) {
          next.append(`filter[${key}]`, value);
        }
      }
      if (view.state.sort) next.set('sort', view.state.sort);
      if (view.state.order) next.set('order', view.state.order);
      if (view.state.pageSize) next.set('pageSize', String(view.state.pageSize));
      if (view.state.q) next.set('q', view.state.q);
      setParams(next, { replace: true });

      if (view.state.columns) setColumnVisibility(view.state.columns);
      if (view.state.density) setDensity(view.state.density);
      setRowSelection({});
    },
    [setParams],
  );

  const exportRows = useCallback(
    async (format: 'csv' | 'xlsx') => {
      // The download goes through fetch rather than a plain link, because the request
      // needs the bearer token that lives in memory.
      const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
      const url = new URL(`${base}${endpoint}`, window.location.origin);
      applyQuery(url, queryParams);
      // An export covers the whole filtered set, not the page being looked at.
      url.searchParams.delete('page');
      url.searchParams.delete('pageSize');
      url.searchParams.set('format', format);

      const token = getAccessToken();
      const response = await fetch(url.toString(), {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(payload?.error?.message ?? "L'export a échoué");
      }

      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `${module}-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    },
    [endpoint, module, queryParams],
  );

  return {
    rows: query.data?.data ?? [],
    total: meta?.total ?? 0,
    page: meta?.page ?? page,
    pageSize: meta?.pageSize ?? pageSize,
    totalPages: meta?.totalPages ?? 1,

    loading: query.isLoading,
    fetching: query.isFetching,
    error: (query.error as Error | null) ?? null,
    refetch: () => void queryClient.invalidateQueries({ queryKey: ['admin', module] }),

    search,
    setSearch: (value) =>
      patchParams((next) => {
        if (value) next.set('q', value);
        else next.delete('q');
      }),

    filters,
    setFilter: (key, values) =>
      patchParams((next) => {
        next.delete(`filter[${key}]`);
        for (const value of values) next.append(`filter[${key}]`, value);
      }),
    toggleFilter: (key, value) =>
      patchParams((next) => {
        const current = next.getAll(`filter[${key}]`);
        next.delete(`filter[${key}]`);
        const updated = current.includes(value)
          ? current.filter((item) => item !== value)
          : [...current, value];
        for (const item of updated) next.append(`filter[${key}]`, item);
      }),
    clearFilters: () =>
      patchParams((next) => {
        for (const key of filterKeys) next.delete(`filter[${key}]`);
        next.delete('q');
      }),
    activeFilterCount:
      Object.values(filters).reduce((sum, values) => sum + values.length, 0) + (search ? 1 : 0),

    sorting: sort ? [{ id: sort, desc: order === 'desc' }] : [],
    setSorting: (updater) => {
      const current: SortingState = sort ? [{ id: sort, desc: order === 'desc' }] : [];
      const nextSorting = typeof updater === 'function' ? updater(current) : updater;
      const first = nextSorting[0];
      patchParams((next) => {
        if (!first) {
          next.delete('sort');
          next.delete('order');
        } else {
          next.set('sort', first.id);
          next.set('order', first.desc ? 'desc' : 'asc');
        }
      });
    },

    setPage: (value) =>
      patchParams((next) => {
        if (value <= 1) next.delete('page');
        else next.set('page', String(value));
      }, false),
    setPageSize: (size) =>
      patchParams((next) => {
        next.set('pageSize', String(size));
      }),

    rowSelection,
    setRowSelection,
    selectedIds,
    clearSelection: () => setRowSelection({}),

    columnVisibility,
    setColumnVisibility,

    density,
    setDensity,

    snapshot,
    applyView,
    exportRows,
    queryKey,
  };
}

/** Saved views for one module. */
export function useSavedViews(module: string) {
  const queryClient = useQueryClient();
  const queryKey = ['admin', 'views', module];

  const query = useQuery({
    queryKey,
    queryFn: () => api<SavedView[]>('/admin/views', { query: { module } }),
    staleTime: 5 * 60_000,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey });

  return {
    views: query.data ?? [],
    loading: query.isLoading,
    async save(name: string, state: SavedViewState, shared = false) {
      await api<SavedView>('/admin/views', {
        method: 'POST',
        body: { module, name, state, isShared: shared, isDefault: false },
      });
      invalidate();
    },
    async rename(id: string, name: string) {
      await api<SavedView>(`/admin/views/${id}`, { method: 'PATCH', body: { name } });
      invalidate();
    },
    async remove(id: string) {
      await api<void>(`/admin/views/${id}`, { method: 'DELETE' });
      invalidate();
    },
  };
}
