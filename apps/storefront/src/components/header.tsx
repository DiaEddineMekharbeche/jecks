'use client';

import { LOCALES, t, type Locale } from '@jecks/shared';
import { cn } from '@jecks/ui';
import { Menu, Search, ShoppingBag, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Dictionary } from '@/lib/dictionary';
import { useCart } from '@/lib/cart-store';
import type { Announcement, MenuNode } from '@/lib/types';

/**
 * Sticky header with the mega-menu of PRD F-ST-02 and the announcement bar of F-ST-03.
 * A client component because it owns the drawer, the search field and the language
 * switcher; the menu data itself is fetched on the server and passed in.
 */
export function Header({
  locale,
  dictionary,
  items,
  announcements,
}: {
  locale: Locale;
  dictionary: Dictionary;
  items: MenuNode[];
  announcements: Announcement[];
}) {
  const pathname = usePathname();
  const cartCount = useCart((state) => state.cart?.itemCount ?? 0);
  const openCart = useCart((state) => state.setOpen);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    setDrawerOpen(false);
    setOpenMenuId(null);
  }, [pathname]);

  // Lock body scroll behind the mobile drawer.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const roots = items.filter((item) => item.parentId === null);
  const childrenOf = (id: string) => items.filter((item) => item.parentId === id);
  const href = (url: string) => (url.startsWith('http') ? url : `/${locale}${url}`);

  return (
    <>
      {announcements.length > 0 ? (
        <div className="bg-brass text-on-brass">
          <div className="shell flex items-center justify-center gap-2 py-2 text-center text-xs font-medium">
            {announcements[0]?.linkUrl ? (
              <Link href={href(announcements[0].linkUrl)} className="underline-offset-4 hover:underline">
                {t(announcements[0].message, locale)}
              </Link>
            ) : (
              <span>{t(announcements[0]!.message, locale)}</span>
            )}
          </div>
        </div>
      ) : null}

      <header className="sticky top-0 z-40 border-b border-line/60 bg-base/85 backdrop-blur-md">
        <div className="shell flex h-16 items-center gap-4">
          <button
            type="button"
            className="lg:hidden"
            aria-label={dictionary.nav.menu}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>

          <Link
            href={`/${locale}`}
            className="font-display text-2xl tracking-[0.22em] text-brass"
            aria-label="Jeck's"
          >
            JECK&apos;S
          </Link>

          <nav className="hidden flex-1 lg:flex" aria-label={dictionary.nav.shop}>
            <ul className="flex items-center gap-1">
              {roots.map((root) => {
                const children = childrenOf(root.id);
                const isOpen = openMenuId === root.id;
                return (
                  <li
                    key={root.id}
                    className="relative"
                    onMouseEnter={() => setOpenMenuId(children.length > 0 ? root.id : null)}
                    onMouseLeave={() => setOpenMenuId(null)}
                  >
                    <Link
                      href={href(root.url)}
                      className="block px-3 py-2 text-sm text-muted transition-colors hover:text-ink"
                      aria-haspopup={children.length > 0 || undefined}
                      aria-expanded={children.length > 0 ? isOpen : undefined}
                      onFocus={() => setOpenMenuId(children.length > 0 ? root.id : null)}
                    >
                      {t(root.label, locale)}
                    </Link>

                    {children.length > 0 && isOpen ? (
                      <div className="absolute start-0 top-full min-w-56 border border-line bg-surface p-2 shadow-card">
                        <ul>
                          {children.map((child) => (
                            <li key={child.id}>
                              <Link
                                href={href(child.url)}
                                className="block rounded-sm px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
                              >
                                {t(child.label, locale)}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="ms-auto flex items-center gap-1">
            <LocaleSwitcher locale={locale} pathname={pathname} />
            <Link
              href={`/${locale}/search`}
              className="p-2 text-muted transition-colors hover:text-ink"
              aria-label={dictionary.nav.search}
            >
              <Search className="h-5 w-5" />
            </Link>
            <button
              type="button"
              onClick={() => openCart(true)}
              className="relative p-2 text-muted transition-colors hover:text-ink"
              aria-label={dictionary.nav.cart}
            >
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 ? (
                <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass px-1 text-[10px] font-semibold tabular-nums text-on-brass">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </header>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={dictionary.nav.close}
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <nav
            className="absolute inset-y-0 start-0 w-80 max-w-[85vw] overflow-y-auto bg-surface p-5"
            aria-label={dictionary.nav.menu}
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="font-display text-xl tracking-[0.2em] text-brass">JECK&apos;S</span>
              <button type="button" aria-label={dictionary.nav.close} onClick={() => setDrawerOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {roots.map((root) => (
                <li key={root.id}>
                  <Link href={href(root.url)} className="block py-2 text-base font-medium">
                    {t(root.label, locale)}
                  </Link>
                  {childrenOf(root.id).length > 0 ? (
                    <ul className="mb-2 ms-3 flex flex-col border-s border-line ps-3">
                      {childrenOf(root.id).map((child) => (
                        <li key={child.id}>
                          <Link href={href(child.url)} className="block py-1.5 text-sm text-muted">
                            {t(child.label, locale)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ) : null}
    </>
  );
}

/** Swaps only the locale segment, so the visitor stays on the page they were reading. */
function LocaleSwitcher({ locale, pathname }: { locale: Locale; pathname: string }) {
  const rest = pathname.replace(new RegExp(`^/${locale}`), '') || '';
  return (
    <div className="flex items-center gap-0.5 pe-1 text-xs">
      {LOCALES.map((code) => (
        <Link
          key={code}
          href={`/${code}${rest}`}
          hrefLang={code}
          aria-current={code === locale ? 'true' : undefined}
          className={cn(
            'rounded-xs px-1.5 py-1 uppercase transition-colors',
            code === locale ? 'text-brass' : 'text-muted hover:text-ink',
          )}
        >
          {code}
        </Link>
      ))}
    </div>
  );
}
