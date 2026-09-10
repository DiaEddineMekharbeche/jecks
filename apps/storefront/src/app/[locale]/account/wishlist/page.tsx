import type { Locale } from '@jecks/shared';
import { WishlistPanel } from '@/components/account/panels';
import { getDictionary } from '@/lib/dictionary';

export default function AccountWishlistPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  return <WishlistPanel locale={locale} dictionary={getDictionary(locale)} />;
}
