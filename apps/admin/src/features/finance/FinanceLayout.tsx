import { cn } from '@jecks/ui';
import { NavLink, Outlet } from 'react-router-dom';

/**
 * Sub-navigation for finance — PRD Section 5.8.
 *
 * The result comes first because it is the question every other screen exists to
 * answer.
 */
const TABS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/finance', label: 'Résultat', end: true },
  { to: '/finance/expenses', label: 'Dépenses' },
  { to: '/finance/ad-spend', label: 'Publicité' },
  { to: '/finance/ledger', label: 'Journal de caisse' },
];

export function FinanceLayout() {
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Sections des finances" className="-mx-1 overflow-x-auto px-1">
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
