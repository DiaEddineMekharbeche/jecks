'use client';

import { format, money, t, type Locale } from '@jecks/shared';
import { Button, cn } from '@jecks/ui';
import { SlidersHorizontal, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { Dictionary } from '@/lib/dictionary';
import type { Facets } from '@/lib/types';

/**
 * Filter rail of PRD F-ST-21: multi-select, URL-persisted, with facet counts.
 *
 * Every choice is written into the query string rather than component state, so the
 * filtered view is shareable, bookmarkable and server-rendered on the next request.
 */
export function FilterRail({
  facets,
  locale,
  dictionary,
}: {
  facets: Facets;
  locale: Locale;
  dictionary: Dictionary;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const selected = useCallback(
    (key: string) => new Set(searchParams.getAll(key)),
    [searchParams],
  );

  const toggle = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const current = params.getAll(key);
      params.delete(key);
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      for (const item of next) params.append(key, item);
      // Any filter change resets to the first page; page 7 of a new filter set is noise.
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setFlag = useCallback(
    (key: string, on: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (on) params.set(key, 'true');
      else params.delete(key);
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const activeCount =
    searchParams.getAll('tag').length +
    searchParams.getAll('brand').length +
    searchParams.getAll('category').length +
    (searchParams.get('inStock') ? 1 : 0) +
    (searchParams.get('onSale') ? 1 : 0);

  const body = (
    <div className="flex flex-col gap-7">
      <FacetGroup
        title={dictionary.listing.availability}
        options={[
          { value: 'inStock', label: dictionary.listing.inStockOnly },
          { value: 'onSale', label: dictionary.listing.onSale },
        ]}
        isChecked={(value) => searchParams.get(value) === 'true'}
        onToggle={(value) => setFlag(value, searchParams.get(value) !== 'true')}
      />

      {facets.categories.length > 0 ? (
        <FacetGroup
          title="Catégorie"
          options={facets.categories.map((item) => ({
            value: item.slug,
            label: t(item.name, locale),
            count: item._count.products,
          }))}
          isChecked={(value) => selected('category').has(value)}
          onToggle={(value) => toggle('category', value)}
        />
      ) : null}

      {facets.tags.length > 0 ? (
        <FacetGroup
          title="Style"
          options={facets.tags.map((item) => ({
            value: item.slug,
            label: t(item.name, locale),
            count: item._count.products,
          }))}
          isChecked={(value) => selected('tag').has(value)}
          onToggle={(value) => toggle('tag', value)}
        />
      ) : null}

      {facets.brands.length > 1 ? (
        <FacetGroup
          title="Marque"
          options={facets.brands.map((item) => ({
            value: item.slug,
            label: item.name,
            count: item._count.products,
          }))}
          isChecked={(value) => selected('brand').has(value)}
          onToggle={(value) => toggle('brand', value)}
        />
      ) : null}

      <div>
        <p className="eyebrow mb-2">{dictionary.listing.price}</p>
        <p className="text-sm text-muted">
          {format(money(BigInt(facets.price.min)))} — {format(money(BigInt(facets.price.max)))}
        </p>
      </div>

      {activeCount > 0 ? (
        <Button variant="outline" size="sm" onClick={() => router.push(pathname, { scroll: false })}>
          {dictionary.listing.clear}
        </Button>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="lg:hidden">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" />
          {dictionary.listing.filters}
          {activeCount > 0 ? ` (${activeCount})` : ''}
        </Button>
      </div>

      <aside className="hidden lg:block lg:w-60 lg:shrink-0">{body}</aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={dictionary.nav.close}
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 end-0 w-80 max-w-[85vw] overflow-y-auto bg-surface p-5">
            <div className="mb-6 flex items-center justify-between">
              <p className="font-medium">{dictionary.listing.filters}</p>
              <button type="button" aria-label={dictionary.nav.close} onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {body}
            <Button className="mt-6 w-full" onClick={() => setOpen(false)}>
              {dictionary.listing.apply}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function FacetGroup({
  title,
  options,
  isChecked,
  onToggle,
}: {
  title: string;
  options: Array<{ value: string; label: string; count?: number }>;
  isChecked: (value: string) => boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="eyebrow mb-2">{title}</legend>
      <ul className="flex flex-col gap-1.5">
        {options.map((option) => {
          const checked = isChecked(option.value);
          return (
            <li key={option.value}>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(option.value)}
                  className="h-4 w-4 accent-brass"
                />
                <span className={cn('flex-1', checked ? 'text-ink' : 'text-muted')}>
                  {option.label}
                </span>
                {option.count === undefined ? null : (
                  <span className="text-xs text-muted tabular-nums">{option.count}</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** Sort control, also URL-persisted — PRD F-ST-22. */
export function SortSelect({ dictionary }: { dictionary: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get('sort') ?? 'relevance';

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{dictionary.listing.sort}</span>
      <select
        value={current}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set('sort', event.target.value);
          params.delete('page');
          router.push(`${pathname}?${params.toString()}`, { scroll: false });
        }}
        className="h-9 rounded-sm border border-line bg-surface px-2 text-sm"
      >
        {Object.entries(dictionary.listing.sortOptions).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
