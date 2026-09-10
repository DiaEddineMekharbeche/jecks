import type { Locale } from '@jecks/shared';
import { OrdersPanel } from '@/components/account/panels';
import { getDictionary } from '@/lib/dictionary';

export default function AccountOrdersPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  return <OrdersPanel locale={locale} dictionary={getDictionary(locale)} />;
}
