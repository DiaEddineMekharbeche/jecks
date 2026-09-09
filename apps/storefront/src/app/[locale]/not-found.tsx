import Link from 'next/link';
import { buttonVariants } from '@jecks/ui';

/**
 * Rendered by `notFound()` from any page in the locale tree. Kept deliberately plain:
 * a 404 should offer a way back, not a shop.
 */
export default function NotFound() {
  return (
    <div className="shell flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="font-display text-display text-brass">404</p>
      <p className="max-w-prose text-muted">
        Cette page n’existe pas ou a été retirée.
      </p>
      <Link href="/" className={buttonVariants({ variant: 'outline', editorial: true })}>
        Retour à la boutique
      </Link>
    </div>
  );
}
