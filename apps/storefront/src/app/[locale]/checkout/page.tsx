import type { Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import { CheckoutForm } from '@/components/checkout-form';
import { getDictionary } from '@/lib/dictionary';

/** Checkout is per-shopper and must never be cached or indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function CheckoutPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  return (
    <div className="shell py-10 lg:py-16">
      <CheckoutForm locale={locale} dictionary={getDictionary(locale)} />
    </div>
  );
}
