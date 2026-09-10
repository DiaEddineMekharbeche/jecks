import type { Locale } from '@jecks/shared';
import { AddressesPanel } from '@/components/account/panels';
import { getDictionary } from '@/lib/dictionary';

export default function AccountAddressesPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  return <AddressesPanel locale={locale} dictionary={getDictionary(locale)} />;
}
