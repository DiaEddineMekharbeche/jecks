import type { Permission } from '@jecks/shared';
import { cn } from '@jecks/ui';
import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '@/features/auth/session';

/**
 * Sub-navigation shared by every catalogue screen — PRD Section 5.2.
 *
 * The catalogue is nine screens under one nav entry. A second row of tabs keeps them
 * one click apart without adding nine items to the left rail, and the URLs stay
 * hierarchical so a bookmarked product still opens inside its section.
 */
const TABS: Array<{ to: string; label: string; end?: boolean; permission?: Permission }> = [
  { to: '/catalog/products', label: 'Produits' },
  { to: '/catalog/categories', label: 'Catégories' },
  { to: '/catalog/collections', label: 'Collections' },
  { to: '/catalog/brands', label: 'Marques' },
  { to: '/catalog/tags', label: 'Étiquettes' },
  { to: '/catalog/attributes', label: 'Attributs' },
  { to: '/catalog/size-guides', label: 'Guides des tailles' },
  { to: '/catalog/reviews', label: 'Avis' },
  { to: '/catalog/merchandising', label: 'Marchandisage' },
  { to: '/catalog/media', label: 'Médias' },
];

export function CatalogLayout() {
  const can = useSession((state) => state.can);
  const visible = TABS.filter((tab) => !tab.permission || can(tab.permission));

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Sections du catalogue" className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max items-center gap-1 border-b border-line">
          {visible.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'relative whitespace-nowrap px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brass'
                    : 'text-muted hover:text-ink',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Outlet />
    </div>
  );
}
