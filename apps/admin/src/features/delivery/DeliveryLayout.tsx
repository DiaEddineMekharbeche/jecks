import type { Permission } from '@jecks/shared';
import { cn } from '@jecks/ui';
import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '@/features/auth/session';

/**
 * Sub-navigation for delivery — PRD Section 5.7.
 *
 * Cash and settlements sit behind `delivery.settle`, so a dispatcher who plans rounds
 * all day never sees the drawer they are not responsible for.
 */
const TABS: Array<{ to: string; label: string; end?: boolean; permission?: Permission }> = [
  { to: '/delivery', label: 'Expéditions', end: true },
  { to: '/delivery/runs', label: 'Tournées' },
  { to: '/delivery/couriers', label: 'Transporteurs' },
  { to: '/delivery/rates', label: 'Tarifs' },
  { to: '/delivery/fleet', label: 'Flotte' },
  { to: '/delivery/cash', label: 'Caisse COD', permission: 'delivery.settle' },
  { to: '/delivery/settlements', label: 'Règlements', permission: 'delivery.settle' },
  { to: '/delivery/analytics', label: 'Analyse' },
];

export function DeliveryLayout() {
  const can = useSession((state) => state.can);
  const visible = TABS.filter((tab) => !tab.permission || can(tab.permission));

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Sections de la livraison" className="-mx-1 overflow-x-auto px-1">
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
