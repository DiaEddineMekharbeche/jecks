import type { Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import { OfferPage } from '@/components/offer-page';

/** The page a sponsored advert points at. Hidden from search: the home page is the same. */
export const revalidate = 120;

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Page({ params }: { params: { locale: string } }) {
  return <OfferPage locale={params.locale as Locale} />;
}
