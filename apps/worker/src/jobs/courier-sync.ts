/**
 * Courier tracking polling — PRD F-AD-61.
 *
 * Only one Algerian courier pushes status changes; the rest have to be asked. This job
 * owns the clock and the API owns the integration: the adapters and the encrypted
 * credentials live beside the database, so duplicating them here would mean two copies
 * of every status mapping and two places to rotate a key.
 *
 * The job therefore calls one internal endpoint and reports what came back. It is
 * deliberately dumb, which also makes it testable without a courier or a database.
 */

export interface SyncConfig {
  /** Base API URL, including the version prefix. */
  apiUrl: string;
  /** Shared secret for internal routes; polling is skipped when it is unset. */
  token: string | undefined;
  /** Parcels asked about per courier per run. */
  limit?: number;
  /** Injected so a test can drive this without a server. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface SyncResult {
  polled: number;
  applied: number;
  couriers: number;
  skipped?: string;
}

export async function pollCourierTracking(config: SyncConfig): Promise<SyncResult> {
  if (!config.token) {
    // Not an error: a shop with no internal token has not configured polling, and a
    // failed job every twenty minutes would bury the ones that matter.
    return { polled: 0, applied: 0, couriers: 0, skipped: 'no internal token configured' };
  }

  const call = config.fetch ?? fetch;
  const controller = new AbortController();
  // Couriers are slow and the schedule comes round again soon; better to give up than
  // to stack overlapping polls.
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 60_000);

  try {
    const response = await call(`${config.apiUrl.replace(/\/$/, '')}/internal/couriers/sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': config.token,
      },
      body: JSON.stringify({ limit: config.limit ?? 200 }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Courier sync failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const parsed = parseReport(text);
    return {
      polled: parsed.polled,
      applied: parsed.applied,
      couriers: parsed.couriers,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads the API's answer, whether or not it is wrapped in the response envelope.
 *
 * The envelope interceptor wraps successful bodies in `{ data }`, but this endpoint is
 * also useful to call by hand, and a shape assumption that breaks silently would show
 * up as a permanently zero polling count.
 */
function parseReport(text: string): { polled: number; applied: number; couriers: number } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Courier sync returned something that is not JSON: ${text.slice(0, 120)}`);
  }

  const payload =
    body && typeof body === 'object' && 'data' in body
      ? (body as { data: unknown }).data
      : body;

  if (!payload || typeof payload !== 'object') return { polled: 0, applied: 0, couriers: 0 };

  const report = payload as { polled?: number; applied?: number; couriers?: unknown[] };
  return {
    polled: Number(report.polled ?? 0),
    applied: Number(report.applied ?? 0),
    couriers: Array.isArray(report.couriers) ? report.couriers.length : 0,
  };
}
