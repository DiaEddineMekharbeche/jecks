import { STOREFRONT_CACHE_TAGS } from '@jecks/shared';
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

/**
 * Lets the API tell the storefront that something it has cached is now wrong.
 *
 * The storefront caches its reads for two to five minutes, which is right for a shop
 * whose catalogue changes a few times a week and wrong for the minute after an owner
 * publishes a product. Without this they publish, look at the shop, see nothing, and
 * conclude the save did not work — PRD F-AD-10 gives it sixty seconds.
 *
 * Guarded by a shared secret rather than a session: the caller is the API, which has no
 * user. Unset, the route refuses everything, because a revalidation endpoint anybody can
 * call is a way to make a shop recompute its home page on demand.
 */

/** The tags the storefront reads with, shared with the API. Anything else is ignored. */
const KNOWN_TAGS: readonly string[] = STOREFRONT_CACHE_TAGS;

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.REVALIDATE_TOKEN;

  if (!secret) {
    return NextResponse.json({ error: 'Revalidation is not configured' }, { status: 503 });
  }

  if (request.headers.get('x-revalidate-token') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { tags?: unknown } | null;
  const requested = Array.isArray(body?.tags) ? body.tags : [];

  // An unknown tag is a caller bug, not a reason to fail: revalidating the ones that are
  // recognised is better than refusing the whole batch because a new one was added on
  // the API side first.
  const tags = requested.filter(
    (tag): tag is string => typeof tag === 'string' && KNOWN_TAGS.includes(tag),
  );

  for (const tag of tags) {
    revalidateTag(tag);
  }

  return NextResponse.json({ revalidated: tags });
}
