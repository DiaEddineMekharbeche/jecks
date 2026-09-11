import { cn } from '@jecks/ui';
import { NavLink, Outlet } from 'react-router-dom';

/**
 * Sub-navigation for content and marketing — PRD Section 5.10.
 *
 * The home page comes first because it is what a shop changes most, and the redirects
 * come last because nobody looks at them until something breaks.
 */
const TABS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/content', label: 'Page d’accueil', end: true },
  { to: '/content/banners', label: 'Bannières' },
  { to: '/content/announcements', label: 'Annonces' },
  { to: '/content/pages', label: 'Pages' },
  { to: '/content/menus', label: 'Menus' },
  { to: '/content/newsletter', label: 'Newsletter' },
  { to: '/content/carts', label: 'Paniers abandonnés' },
  { to: '/content/affiliates', label: 'Affiliés' },
  { to: '/content/redirects', label: 'Redirections' },
];

export function ContentLayout() {
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Sections du contenu" className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max items-center gap-1 border-b border-line">
          {TABS.map((tab) => (
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
