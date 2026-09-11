import { cn } from '@jecks/ui';
import { NavLink, Outlet } from 'react-router-dom';

/**
 * Sub-navigation for marketing — PRD Section 5.11.
 *
 * Separate from Contenu because they answer to different permissions: content is what
 * the shop says about itself, marketing is who it says it to, and a shop can reasonably
 * let somebody edit one without the other.
 */
const TABS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/marketing', label: 'Newsletter', end: true },
  { to: '/marketing/carts', label: 'Paniers abandonnés' },
  { to: '/marketing/affiliates', label: 'Affiliés' },
];

export function MarketingLayout() {
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Sections du marketing" className="-mx-1 overflow-x-auto px-1">
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
