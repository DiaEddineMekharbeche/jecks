import type { Locale } from '@jecks/shared';
import { ProfilePanel } from '@/components/account/panels';
import { getDictionary } from '@/lib/dictionary';

export default function AccountPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  return <ProfilePanel locale={locale} dictionary={getDictionary(locale)} />;
}
