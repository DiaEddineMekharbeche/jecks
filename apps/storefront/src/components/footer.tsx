import { t, type Locale } from '@jecks/shared';
import Link from 'next/link';
import type { Dictionary } from '@/lib/dictionary';
import type { MenuNode } from '@/lib/types';
import { NewsletterForm } from './newsletter-form';

/** Footer sitemap, newsletter and legal line — PRD F-ST-04. */
export function Footer({
  locale,
  dictionary,
  items,
  storeName,
}: {
  locale: Locale;
  dictionary: Dictionary;
  items: MenuNode[];
  storeName: string;
}) {
  const groups = items.filter((item) => item.parentId === null);
  const childrenOf = (id: string) => items.filter((item) => item.parentId === id);
  const href = (url: string) => (url.startsWith('http') ? url : `/${locale}${url}`);

  return (
    <footer className="mt-section border-t border-line bg-surface">
      <div className="shell grid gap-10 py-12 md:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <p className="font-display text-3xl tracking-[0.2em] text-brass">JECK&apos;S</p>
          <p className="mt-3 max-w-prose text-sm text-muted">{dictionary.footer.newsletterHint}</p>
          <NewsletterForm dictionary={dictionary} locale={locale} />
        </div>

        {/* Always present, whatever the owner put in the footer menu: tracking an order
            without an account is the single most-asked question an agent answers. */}
        <nav aria-label={dictionary.account.title}>
          <p className="eyebrow mb-3">{dictionary.account.title}</p>
          <ul className="flex flex-col gap-2">
            {[
              { to: `/${locale}/track`, label: dictionary.track.title },
              { to: `/${locale}/account/orders`, label: dictionary.account.orders },
              { to: `/${locale}/contact`, label: dictionary.contact.title },
            ].map((link) => (
              <li key={link.to}>
                <Link
                  href={link.to}
                  className="text-sm text-muted transition-colors hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {groups.map((group) => (
          <nav key={group.id} aria-label={t(group.label, locale)}>
            <p className="eyebrow mb-3">{t(group.label, locale)}</p>
            <ul className="flex flex-col gap-2">
              {childrenOf(group.id).map((child) => (
                <li key={child.id}>
                  <Link
                    href={href(child.url)}
                    className="text-sm text-muted transition-colors hover:text-ink"
                  >
                    {t(child.label, locale)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-line">
        <div className="shell flex flex-col gap-2 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {storeName}. {dictionary.footer.rights}
          </p>
          <p>{dictionary.footer.madeIn}</p>
        </div>
      </div>
    </footer>
  );
}
