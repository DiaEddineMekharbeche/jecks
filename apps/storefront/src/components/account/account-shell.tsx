'use client';

import { type Locale } from '@jecks/shared';
import { cn } from '@jecks/ui';
import { Heart, LogOut, MapPin, Package, Sparkles, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { SignIn } from './sign-in';
import { useSession } from '@/lib/session-store';
import type { Dictionary } from '@/lib/dictionary';

/**
 * The account area's frame — PRD F-ST-51.
 *
 * One gate rather than five: every account page renders inside this, so the sign-in
 * check and the navigation exist once and no page can forget either.
 */
export function AccountShell({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: ReactNode;
}) {
  const status = useSession((state) => state.status);
  const shopper = useSession((state) => state.shopper);
  const load = useSession((state) => state.load);
  const signOut = useSession((state) => state.signOut);
  const pathname = usePathname();

  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'loading') {
    return (
      <div className="shell py-16">
        <p className="text-sm text-muted">{dictionary.common.loading}</p>
      </div>
    );
  }

  if (status === 'anonymous') {
    return (
      <div className="shell py-16">
        <SignIn dictionary={dictionary} />
      </div>
    );
  }

  const links = [
    { href: `/${locale}/account`, label: dictionary.account.profile, icon: User, exact: true },
    { href: `/${locale}/account/orders`, label: dictionary.account.orders, icon: Package },
    { href: `/${locale}/account/addresses`, label: dictionary.account.addresses, icon: MapPin },
    { href: `/${locale}/account/wishlist`, label: dictionary.account.wishlist, icon: Heart },
    { href: `/${locale}/account/loyalty`, label: dictionary.account.loyalty, icon: Sparkles },
  ];

  return (
    <div className="shell grid gap-8 py-10 lg:grid-cols-[200px_1fr] lg:py-16">
      <nav aria-label={dictionary.account.title} className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-4 text-sm">
          <span className="text-muted">{dictionary.account.title}</span>
          <br />
          <span className="font-medium">{shopper?.name}</span>
        </p>

        <ul className="flex flex-col gap-0.5">
          {links.map((link) => {
            const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={cn(
                    'flex items-center gap-2 rounded-xs px-3 py-2 text-sm transition-colors',
                    active ? 'bg-elevated text-ink' : 'text-muted hover:text-ink',
                  )}
                >
                  <link.icon className="h-4 w-4" />
                  {link.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2 rounded-xs px-3 py-2 text-sm text-muted transition-colors hover:text-danger"
            >
              <LogOut className="h-4 w-4" />
              {dictionary.account.signOut}
            </button>
          </li>
        </ul>
      </nav>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
