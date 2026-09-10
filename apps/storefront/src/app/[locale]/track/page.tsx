import type { Locale } from '@jecks/shared';
import type { Metadata } from 'next';
import { TrackForm } from '@/components/track-form';
import { getDictionary } from '@/lib/dictionary';

export function generateMetadata({ params }: { params: { locale: string } }): Metadata {
  const dictionary = getDictionary(params.locale as Locale);
  return { title: dictionary.track.title, robots: { index: true, follow: true } };
}

export default function TrackPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  return (
    <div className="shell py-16">
      <TrackForm locale={locale} dictionary={getDictionary(locale)} />
    </div>
  );
}
