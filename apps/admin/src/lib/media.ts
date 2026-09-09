import { pickRendition, type Rendition } from '@jecks/shared';

/**
 * Builds the URL of a generated rendition from the original file's URL.
 *
 * The API sends a media row with one `url` — the original — plus the rendition keys the
 * worker produced. Both are served from the same `/media/` prefix, so swapping the key
 * in the path is enough, and the admin never has to know whether that prefix is the API
 * or a CDN in front of the bucket.
 */
export function renditionUrl(url: string, key: string | null | undefined): string {
  if (!key) return url;
  return url.replace(/\/media\/.*$/, `/media/${key}`);
}

/** The smallest rendition at least `minWidth` wide, or the original when there is none. */
export function previewUrl(
  media: { url: string; renditions?: Rendition[] | null; posterUrl?: string | null },
  minWidth: number,
): string {
  const rendition = pickRendition(media.renditions, minWidth);
  if (rendition) return renditionUrl(media.url, rendition.key);
  return media.posterUrl ?? media.url;
}
