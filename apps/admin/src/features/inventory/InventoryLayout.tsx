import type { Permission } from '@jecks/shared';
import { cn } from '@jecks/ui';
import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '@/features/auth/session';

/**
 * Sub-navigation for the stock module — PRD Section 5.6.
 *
 * Purchasing sits behind its own permission, so a warehouse hand who may count stock
 * but not commit money to a supplier simply does not see those tabs.
 */
const TABS: Array<{ to: string; label: string; end?: boolean; permission?: Permission }> = [
  { to: '/inventory', label: 'Stock', end: true },
  { to: '/inventory/movements', label: 'Mouvements' },
  { to: '/inventory/counts', label: 'Inventaires' },
  { to: '/inventory/purchase-orders', label: 'Commandes fournisseur', permission: 'purchasing.read' },
  { to: '/inventory/suppliers', label: 'Fournisseurs', permission: 'purchasing.read' },
  { to: '/inventory/locations', label: 'Emplacements' },
];

export function InventoryLayout() {
  const can = useSession((state) => state.can);
  const visible = TABS.filter((tab) => !tab.permission || can(tab.permission));

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Sections du stock" className="-mx-1 overflow-x-auto px-1">
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
