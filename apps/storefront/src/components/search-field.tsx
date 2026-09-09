'use client';

import type { Locale } from '@jecks/shared';
import { Input } from '@jecks/ui';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Dictionary } from '@/lib/dictionary';

/**
 * Search box. Submitting navigates rather than fetching, so the results page is a real
 * URL that can be shared and that the server renders (PRD F-ST-25).
 */
export function SearchField({
  locale,
  dictionary,
  defaultValue = '',
}: {
  locale: Locale;
  dictionary: Dictionary;
  defaultValue?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const query = value.trim();
    if (query.length < 2) return;
    router.push(`/${locale}/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <form onSubmit={handleSubmit} role="search" className="relative">
      <label htmlFor="site-search" className="sr-only">
        {dictionary.nav.search}
      </label>
      <Search
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <Input
        id="site-search"
        type="search"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={dictionary.search.placeholder}
        className="ps-10"
        autoComplete="off"
      />
    </form>
  );
}
