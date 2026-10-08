import type { Locale } from '@jecks/shared';
import { OfferPage } from '@/components/offer-page';

/**
 * The home page is the shop and the order form in one: a swipeable picture of every
 * product, a strip to jump between them, and the form open underneath. A shopper orders
 * without going anywhere else.
 *
 * It reads no `searchParams`, so it can be cached: a page that reads them and is also
 * cached with `revalidate` fails in a production build with a 500. The filtered grid that
 * used to be here lives on the collection and search pages.
 */
export const revalidate = 120;

export default function HomePage({ params }: { params: { locale: string } }) {
  return <OfferPage locale={params.locale as Locale} />;
}
