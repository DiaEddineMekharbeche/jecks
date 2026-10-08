import { OrderSource } from '@jecks/shared';

export interface Attribution {
  source: OrderSource;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
}

/**
 * Which channel an advert click came from, read off the address the advert pointed at.
 *
 * Meta appends nothing by itself that is dependable, so the ad's URL carries
 * `?utm_source=facebook` (or `instagram`) and this maps it to the order's source. An
 * unknown or missing value is a plain web order rather than a guess.
 */
const CHANNELS: Array<[RegExp, OrderSource]> = [
  [/^(ig|instagram)/i, OrderSource.INSTAGRAM],
  [/^(fb|facebook|meta)/i, OrderSource.FACEBOOK],
  [/^(tt|tiktok)/i, OrderSource.TIKTOK],
  [/^(wa|whatsapp)/i, OrderSource.WHATSAPP],
];

export function readAttribution(search: string): Attribution {
  const params = new URLSearchParams(search);
  const pick = (key: string) => params.get(key)?.trim().slice(0, 120) || undefined;

  const utm = {
    source: pick('utm_source'),
    medium: pick('utm_medium'),
    campaign: pick('utm_campaign'),
    content: pick('utm_content'),
    term: pick('utm_term'),
  };
  const hasUtm = Object.values(utm).some(Boolean);

  const source =
    CHANNELS.find(([pattern]) => pattern.test(utm.source ?? ''))?.[1] ?? OrderSource.WEB;

  return { source, utm: hasUtm ? utm : undefined };
}
