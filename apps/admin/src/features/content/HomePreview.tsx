import { Button, Card, CardBody, CardHeader, CardTitle, cn } from '@jecks/ui';
import { ExternalLink, Monitor, RefreshCw, Smartphone } from 'lucide-react';
import { useState } from 'react';

/**
 * The home page as the shop sees it — PRD F-AD-23.
 *
 * An iframe of the live storefront rather than a re-implementation of every block
 * inside the admin. A second renderer is a second set of bugs, and the one that matters
 * is always the one the customer loads.
 *
 * It shows what is **published**, not a draft: scheduled blocks appear when their window
 * opens, because the storefront filters on read (D83). The plan asked for a signed
 * preview token that would let the builder see a block before its start date; that needs
 * the storefront to accept the token and bypass the window, and is not built. Saying so
 * on the panel is better than letting somebody believe they are previewing a draft.
 */

const STOREFRONT_URL =
  (import.meta.env.VITE_STOREFRONT_URL as string | undefined) ?? 'http://localhost:3000';

const WIDTHS = {
  desktop: '100%',
  mobile: '390px',
} as const;

type Device = keyof typeof WIDTHS;

export function HomePreview({ locale = 'fr' }: { locale?: string }) {
  const [device, setDevice] = useState<Device>('desktop');
  // Changing the key remounts the iframe, which is the only reliable way to reload a
  // cross-origin frame: its history is not reachable from here.
  const [reloadKey, setReloadKey] = useState(0);

  const url = `${STOREFRONT_URL}/${locale}`;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>Aperçu</CardTitle>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={device === 'desktop' ? 'outline' : 'ghost'}
            aria-pressed={device === 'desktop'}
            onClick={() => setDevice('desktop')}
          >
            <Monitor className="h-4 w-4" />
            Bureau
          </Button>
          <Button
            size="sm"
            variant={device === 'mobile' ? 'outline' : 'ghost'}
            aria-pressed={device === 'mobile'}
            onClick={() => setDevice('mobile')}
          >
            <Smartphone className="h-4 w-4" />
            Mobile
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw className="h-4 w-4" />
            Recharger
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-xs text-muted transition-colors hover:text-brass"
          >
            <ExternalLink className="h-4 w-4" />
            Ouvrir
          </a>
        </div>
      </CardHeader>

      <CardBody className="flex flex-col gap-2">
        <div
          className={cn(
            'overflow-hidden rounded-sm border border-line bg-base',
            device === 'mobile' && 'mx-auto',
          )}
          style={{ width: WIDTHS[device] }}
        >
          <iframe
            key={reloadKey}
            src={url}
            title="Aperçu de la page d’accueil"
            className="h-[560px] w-full"
            // The storefront is the shop's own origin, but the frame has no business
            // reading this page's session, so it is sandboxed to what a visitor needs.
            sandbox="allow-scripts allow-same-origin allow-popups"
            loading="lazy"
          />
        </div>

        <p className="text-xs text-muted">
          Montre ce qui est <strong className="font-medium text-ink">publié</strong>. Un bloc
          programmé apparaîtra à sa date de début. Rechargez après avoir enregistré.
        </p>
      </CardBody>
    </Card>
  );
}
