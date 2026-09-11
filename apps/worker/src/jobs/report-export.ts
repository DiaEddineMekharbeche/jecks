/**
 * Running a queued report export — PRD Section 5.9 and M7.
 *
 * The same split as courier polling and the nightly maintenance: the worker owns the
 * queue slot, the retry and the timeout; the API owns the query, because the report
 * lives beside the database and a second implementation here would eventually give a
 * different number.
 *
 * What the worker adds is that nobody is holding a connection open. A year of order
 * lines takes a minute to assemble, which a browser download cannot survive and a
 * background job does not mind.
 */

export interface ExportConfig {
  apiUrl: string;
  token: string | undefined;
  fetch?: typeof fetch;
  /** Generous: this is a report over a year, not a health check. */
  timeoutMs?: number;
}

export interface ExportResult {
  jobId: string;
  skipped?: string;
  rows?: number;
  key?: string;
}

export async function runReportExport(
  jobId: string,
  config: ExportConfig,
): Promise<ExportResult> {
  if (!jobId) throw new Error('report.export was queued without a jobId');

  if (!config.token) {
    // Without the token the route does not exist. Failing loudly here is right, unlike
    // the nightly tasks: somebody pressed a button and is watching for a file.
    throw new Error('INTERNAL_API_TOKEN is not set; the export route is disabled');
  }

  const call = config.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 600_000);

  try {
    const response = await call(`${config.apiUrl.replace(/\/$/, '')}/internal/reports/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
      body: JSON.stringify({ jobId }),
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      // The API has already marked the row failed with the real reason; this message is
      // for the queue screen.
      throw new Error(`Export ${jobId} failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const payload = unwrap(text);
    return {
      jobId,
      rows: typeof payload.rows === 'number' ? payload.rows : undefined,
      key: typeof payload.key === 'string' ? payload.key : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Reads the body whether or not it arrived inside the response envelope. */
function unwrap(text: string): Record<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`The export route returned something that is not JSON: ${text.slice(0, 120)}`);
  }

  const payload =
    body && typeof body === 'object' && 'data' in body ? (body as { data: unknown }).data : body;

  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}
