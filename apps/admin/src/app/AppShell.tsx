import { Badge, Button, cn } from '@jecks/ui';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '@/features/auth/session';
import { NAVIGATION } from './navigation';

/**
 * Two-column admin shell: a persistent left nav and the routed screen.
 * The nav collapses behind a button below `lg`, because the owner checks orders from
 * a phone (PRD Section 9.3).
 */
export function AppShell() {
  const user = useSession((state) => state.user);
  const can = useSession((state) => state.can);
  const signOut = useSession((state) => state.signOut);
  const location = useLocation();

  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => readStoredTheme());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('jk-admin-theme', theme);
    } catch {
      // Private browsing blocks storage; the toggle still works for this session.
    }
  }, [theme]);

  // Any navigation closes the mobile drawer.
  useEffect(() => setNavOpen(false), [location.pathname]);

  const items = NAVIGATION.filter((item) => can(item.permission));

  return (
    <div className="flex min-h-screen bg-base text-ink">
      {navOpen ? (
        <button
          type="button"
          aria-label="Fermer le menu"
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 z-40 flex w-64 flex-col border-e border-line bg-surface transition-transform duration-200 ease-brand lg:static lg:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-line px-5">
          <span className="font-display text-2xl tracking-[0.18em] text-brass">JECK&apos;S</span>
          <button
            type="button"
            className="text-muted lg:hidden"
            aria-label="Fermer le menu"
            onClick={() => setNavOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3" aria-label="Navigation principale">
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => {
              const Icon = item.icon;
              const planned = item.status === 'planned';
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors',
                        isActive
                          ? 'bg-brass/12 font-medium text-brass'
                          : 'text-muted hover:bg-elevated hover:text-ink',
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {planned ? <Badge tone="neutral">{item.milestone}</Badge> : null}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-line p-3">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted">{user?.roles.join(', ')}</p>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" />
            Se déconnecter
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-line bg-surface px-4 lg:px-6">
          <button
            type="button"
            className="text-muted lg:hidden"
            aria-label="Ouvrir le menu"
            onClick={() => setNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            aria-label={theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>

        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function readStoredTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem('jk-admin-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Ignore: fall through to the light default the admin is designed around.
  }
  return 'light';
}
