/**
 * The nightly tasks — PRD F-AD-40, F-AD-71 and Section 6.5.
 *
 * Same split as courier polling: the worker owns the clock, the API owns the rules. The
 * segmentation thresholds, the loyalty policy and the recurrence maths all live beside
 * the database, and a second copy here would eventually give a different answer.
 */

export interface TaskConfig {
  apiUrl: string;
  token: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type MaintenanceTask = 'recurring-expenses' | 'segments' | 'loyalty-expiry';

export interface TaskResult {
  task: MaintenanceTask;
  skipped?: string;
  /** Whatever the endpoint reported, passed through for the job log. */
  report: Record<string, unknown>;
}

export async function runMaintenanceTask(
  task: MaintenanceTask,
  config: TaskConfig,
): Promise<TaskResult> {
  if (!config.token) {
    // Not an error: a deployment without an internal token has not configured these,
    // and a failed job every night would bury the ones that matter.
    return { task, skipped: 'no internal token configured', report: {} };
  }

  const call = config.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 120_000);

  try {
    const response = await call(
      `${config.apiUrl.replace(/\/$/, '')}/internal/maintenance/${task}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
        body: '{}',
        signal: controller.signal,
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${task} failed (${response.status}): ${text.slice(0, 200)}`);
    }

    return { task, report: unwrap(text) };
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
    throw new Error(`Maintenance returned something that is not JSON: ${text.slice(0, 120)}`);
  }

  const payload =
    body && typeof body === 'object' && 'data' in body ? (body as { data: unknown }).data : body;

  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}
