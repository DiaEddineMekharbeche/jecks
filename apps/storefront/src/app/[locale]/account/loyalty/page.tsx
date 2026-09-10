import type { Locale } from '@jecks/shared';
import { LoyaltyPanel } from '@/components/account/panels';
import { getDictionary } from '@/lib/dictionary';

export default function AccountLoyaltyPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  return <LoyaltyPanel locale={locale} dictionary={getDictionary(locale)} />;
}
