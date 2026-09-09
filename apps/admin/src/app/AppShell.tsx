import { Badge, Button, Kbd, Tooltip, cn, useCommandPalette } from '@jecks/ui';
import { Bell, BellOff, LogOut, Menu, Moon, Search, Sun, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '@/features/auth/session';
import { useAdminEventStream, useRealtimeStore } from '@/lib/realtime';
import { CommandPalette } from './CommandPalette';
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

  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const realtimeStatus = useRealtimeStore((state) => state.status);
  const unseen = useRealtimeStore((state) => state.unseen);
  const clearUnseen = useRealtimeStore((state) => state.clearUnseen);
  const soundEnabled = useRealtimeStore((state) => state.soundEnabled);
  const toggleSound = useRealtimeStore((state) => state.toggleSound);

  // One stream for the whole session, opened once the user is known.
  useAdminEventStream(Boolean(user));

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
              const pending = unseen[item.key] ?? 0;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => clearUnseen(item.key)}
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
                    {/* A live count outranks the milestone tag: it needs acting on. */}
                    {pending > 0 ? (
                      <Badge tone="brass" className="animate-badge-pop">
                        {pending}
                      </Badge>
                    ) : planned ? (
                      <Badge tone="neutral">{item.milestone}</Badge>
                    ) : null}
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
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-sm border border-line px-3 text-sm text-muted transition-colors hover:border-muted hover:text-ink sm:max-w-sm"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">Rechercher…</span>
            <Kbd className="ms-auto hidden sm:inline-flex">⌘K</Kbd>
          </button>

          <div className="ms-auto flex items-center gap-1">
            <Tooltip
              content={
                realtimeStatus === 'open'
                  ? 'Mises à jour en direct actives'
                  : 'Connexion aux mises à jour en direct…'
              }
            >
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center',
                  realtimeStatus === 'open' ? 'text-success' : 'text-muted',
                )}
                role="status"
                aria-label={realtimeStatus === 'open' ? 'En direct' : 'Hors ligne'}
              >
                {realtimeStatus === 'open' ? (
                  <Wifi className="h-4 w-4" />
                ) : (
                  <WifiOff className="h-4 w-4" />
                )}
              </span>
            </Tooltip>

            <Button
              variant="ghost"
              size="icon"
              aria-label={soundEnabled ? 'Couper le son des alertes' : 'Activer le son des alertes'}
              aria-pressed={soundEnabled}
              onClick={toggleSound}
            >
              {soundEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              aria-label={theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
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
