import type { Locale } from '@jecks/shared';
import { WifiOff } from 'lucide-react';
import Link from 'next/link';
import { getDictionary } from '@/lib/dictionary';

/** Served by the service worker when a navigation happens with no network. */
export const dynamic = 'force-static';

export default function OfflinePage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  const dictionary = getDictionary(locale);

  return (
    <div className="shell flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <WifiOff className="h-10 w-10 text-muted" />
      <h1 className="text-section">
        {locale === 'ar'
          ? 'لا يوجد اتصال بالإنترنت'
          : locale === 'en'
            ? 'You are offline'
            : 'Vous êtes hors ligne'}
      </h1>
      <p className="max-w-sm text-sm text-muted">
        {locale === 'ar'
          ? 'تحقق من اتصالك ثم أعد المحاولة. الصفحات التي زرتها من قبل تبقى متاحة.'
          : locale === 'en'
            ? 'Check your connection and try again. Pages you already visited stay available.'
            : 'Vérifiez votre connexion puis réessayez. Les pages déjà visitées restent accessibles.'}
      </p>
      <Link
        href={`/${locale}`}
        className="border border-line px-5 py-2 text-sm uppercase tracking-wider transition-colors hover:border-brass hover:text-brass"
      >
        {dictionary.common.home}
      </Link>
    </div>
  );
}
