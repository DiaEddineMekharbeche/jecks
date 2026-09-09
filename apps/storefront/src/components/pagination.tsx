'use client';

import { buttonVariants, cn } from '@jecks/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { Dictionary } from '@/lib/dictionary';

/**
 * Page links rather than an infinite scroll button, because a paginated collection is
 * crawlable and each page has its own URL (PRD F-ST-20, F-ST-05).
 */
export function Pagination({
  page,
  totalPages,
  dictionary,
}: {
  page: number;
  totalPages: number;
  dictionary: Dictionary;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  const hrefFor = (target: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (target <= 1) params.delete('page');
    else params.set('page', String(target));
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  return (
    <nav className="mt-12 flex items-center justify-center gap-1" aria-label="Pagination">
      <PageLink
        href={hrefFor(page - 1)}
        disabled={page <= 1}
        label={dictionary.common.back}
        icon={<ChevronLeft className="h-4 w-4 rtl:rotate-180" />}
      />

      {pageWindow(page, totalPages).map((entry, index) =>
        entry === 'gap' ? (
          <span key={`gap-${index}`} className="px-2 text-muted">
            …
          </span>
        ) : (
          <Link
            key={entry}
            href={hrefFor(entry)}
            aria-current={entry === page ? 'page' : undefined}
            className={cn(
              buttonVariants({ variant: entry === page ? 'primary' : 'ghost', size: 'sm' }),
              'min-w-9 tabular-nums',
            )}
          >
            {entry}
          </Link>
        ),
      )}

      <PageLink
        href={hrefFor(page + 1)}
        disabled={page >= totalPages}
        label={dictionary.listing.loadMore}
        icon={<ChevronRight className="h-4 w-4 rtl:rotate-180" />}
      />
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  icon,
}: {
  href: string;
  disabled: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'opacity-40')}
      >
        {icon}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
      {icon}
    </Link>
  );
}

/** First, last, and a window around the current page; gaps collapse to an ellipsis. */
function pageWindow(page: number, totalPages: number): Array<number | 'gap'> {
  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);

  const out: Array<number | 'gap'> = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous && value - previous > 1) out.push('gap');
    out.push(value);
    previous = value;
  }
  return out;
}
