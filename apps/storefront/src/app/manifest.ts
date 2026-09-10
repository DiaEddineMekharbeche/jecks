import type { MetadataRoute } from 'next';

/**
 * Web app manifest — PRD F-ST-54.
 *
 * Standalone display so an installed shortcut opens without browser chrome, which is
 * how a returning shopper on a mid-range Android reaches the shop fastest. The theme
 * colour matches the brand's base rather than the accent: the status bar sits above a
 * dark page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jeck's — Casquettes et chapeaux",
    short_name: "Jeck's",
    description:
      'Casquettes dessinées à Alger, séries courtes, paiement à la livraison dans les 58 wilayas.',
    start_url: '/fr',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0F0F10',
    theme_color: '#0F0F10',
    lang: 'fr',
    dir: 'ltr',
    categories: ['shopping', 'lifestyle'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Suivre ma commande', url: '/fr/track' },
      { name: 'Mon compte', url: '/fr/account' },
    ],
  };
}
