import type { Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AccountShell } from '@/components/account/account-shell';
import { getDictionary } from '@/lib/dictionary';

/** The account area is per-shopper, so it is never cached or indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function AccountLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  const locale = params.locale as Locale;
  return (
    <AccountShell locale={locale} dictionary={getDictionary(locale)}>
      {children}
    </AccountShell>
  );
}
