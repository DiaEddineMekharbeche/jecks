import type { GlobalSearchHit } from '@jecks/shared';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { Package, ShoppingCart, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { NAVIGATION } from './navigation';

/**
 * ⌘K palette — PRD Section 9.3: any order, product or customer in two keystrokes.
 *
 * With no query it lists the navigation, so the shortcut is also the fastest way to
 * move around. Typing switches to server-side search across the three entities the
 * operator actually hunts for.
 */

const GROUP_META: Record<
  GlobalSearchHit['group'],
  { label: string; icon: typeof ShoppingCart }
> = {
  orders: { label: 'Commandes', icon: ShoppingCart },
  products: { label: 'Produits', icon: Package },
  customers: { label: 'Clients', icon: Users },
};

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  // One request per pause in typing, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 180);
    return () => clearTimeout(timer);
  }, [term]);

  // Reopening should not show the previous search.
  useEffect(() => {
    if (!open) {
      setTerm('');
      setDebounced('');
    }
  }, [open]);

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['palette', debounced],
    queryFn: () => api<GlobalSearchHit[]>('/admin/search', { query: { q: debounced, limit: 5 } }),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  });

  const navItems = NAVIGATION.filter(
    (item) =>
      can(item.permission) &&
      (term === '' || item.label.toLowerCase().includes(term.trim().toLowerCase())),
  );

  function go(href: string) {
    onOpenChange(false);
    navigate(href);
  }

  const grouped = (['orders', 'products', 'customers'] as const)
    .map((group) => ({ group, items: hits.filter((hit) => hit.group === group) }))
    .filter((entry) => entry.items.length > 0);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={term}
        onValueChange={setTerm}
        placeholder="Commande, produit, client, ou une page…"
      />
      <CommandList>
        <CommandEmpty>
          {isFetching
            ? 'Recherche…'
            : debounced.length >= 2
              ? 'Aucun résultat'
              : 'Tapez au moins 2 caractères'}
        </CommandEmpty>

        {grouped.map(({ group, items }) => {
          const meta = GROUP_META[group];
          const Icon = meta.icon;
          return (
            <CommandGroup key={group} heading={meta.label}>
              {items.map((hit) => (
                <CommandItem key={hit.id} value={`${group}-${hit.id}`} onSelect={() => go(hit.href)}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{hit.title}</span>
                    {hit.subtitle ? (
                      <span className="block truncate text-xs text-muted">{hit.subtitle}</span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        {grouped.length > 0 && navItems.length > 0 ? <CommandSeparator /> : null}

        {navItems.length > 0 ? (
          <CommandGroup heading="Aller à">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem key={item.to} value={`nav-${item.to}`} onSelect={() => go(item.to)}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
