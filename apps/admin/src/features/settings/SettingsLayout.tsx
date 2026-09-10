import type { Permission } from '@jecks/shared';
import { cn } from '@jecks/ui';
import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '@/features/auth/session';

/**
 * Settings navigation — PRD F-AD-91.
 *
 * A left rail rather than tabs: there are fifteen sections, and a horizontal strip that
 * scrolls sideways is where settings go to be never found again.
 */
interface Section {
  to: string;
  label: string;
  end?: boolean;
  permission?: Permission;
  group: string;
}

export const SETTINGS_SECTIONS: Section[] = [
  { to: '/settings/store', label: 'Boutique', group: 'Général' },
  { to: '/settings/localisation', label: 'Langues et fuseau', group: 'Général' },
  { to: '/settings/tax', label: 'TVA', group: 'Général' },
  { to: '/settings/theme', label: 'Thème', group: 'Général' },

  { to: '/settings/orders', label: 'Commandes', group: 'Vente' },
  { to: '/settings/checkout', label: 'Paiement en ligne de caisse', group: 'Vente' },
  { to: '/settings/loyalty', label: 'Fidélité', group: 'Vente' },
  { to: '/settings/inventory', label: 'Stock', group: 'Vente' },

  { to: '/settings/payments', label: 'Paiements', group: 'Intégrations' },
  { to: '/settings/couriers', label: 'Transporteurs', group: 'Intégrations' },
  { to: '/settings/notifications', label: 'Notifications', group: 'Intégrations' },
  { to: '/settings/templates', label: 'Modèles de messages', group: 'Intégrations' },
  { to: '/settings/integrations', label: 'Pixels et analytics', group: 'Intégrations' },

  { to: '/settings/users', label: 'Équipe', group: 'Administration', permission: 'users.read' },
  { to: '/settings/roles', label: 'Rôles', group: 'Administration', permission: 'users.read' },
  { to: '/settings/backups', label: 'Sauvegardes', group: 'Administration' },
  { to: '/settings/maintenance', label: 'Maintenance', group: 'Administration' },
];

export function SettingsLayout() {
  const can = useSession((state) => state.can);
  const visible = SETTINGS_SECTIONS.filter((section) => !section.permission || can(section.permission));

  const groups = visible.reduce<Record<string, Section[]>>((acc, section) => {
    (acc[section.group] ??= []).push(section);
    return acc;
  }, {});

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Sections des réglages" className="lg:sticky lg:top-4 lg:self-start">
        <div className="flex flex-col gap-5">
          {Object.entries(groups).map(([group, sections]) => (
            <div key={group}>
              <p className="px-3 pb-1.5 text-[11px] uppercase tracking-wider text-muted">{group}</p>
              <div className="flex flex-col">
                {sections.map((section) => (
                  <NavLink
                    key={section.to}
                    to={section.to}
                    end={section.end}
                    className={({ isActive }) =>
                      cn(
                        'rounded-sm px-3 py-1.5 text-sm transition-colors',
                        isActive
                          ? 'bg-elevated font-medium text-ink'
                          : 'text-muted hover:bg-elevated/60 hover:text-ink',
                      )
                    }
                  >
                    {section.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
