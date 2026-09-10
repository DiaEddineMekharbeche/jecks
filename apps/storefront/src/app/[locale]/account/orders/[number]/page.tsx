import type { Locale } from '@jecks/shared';
import { OrderDetailLoader } from '@/components/account/order-detail-loader';
import { getDictionary } from '@/lib/dictionary';

export default function AccountOrderPage({
  params,
}: {
  params: { locale: string; number: string };
}) {
  const locale = params.locale as Locale;
  return (
    <OrderDetailLoader
      number={decodeURIComponent(params.number).toUpperCase()}
      locale={locale}
      dictionary={getDictionary(locale)}
    />
  );
}
