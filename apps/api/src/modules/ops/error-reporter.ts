import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Error reporting — PRD Section 10.5.
 *
 * An interface with two implementations, chosen by whether `SENTRY_DSN` is set. The
 * default writes to the log, which is where a single-VPS shop reads its errors anyway;
 * Sentry is an addition for when somebody is paid to watch.
 *
 * Sentry's ingestion is a documented HTTP endpoint, so this posts to it directly rather
 * than pulling in the SDK. The SDK's value is its automatic instrumentation — patching
 * every async boundary in the process — and that is exactly what a shop running one
 * container does not need.
 */

export interface ErrorContext {
  /** The correlation id the request already carries, so logs and Sentry line up. */
  correlationId?: string;
  route?: string;
  method?: string;
  userId?: string | null;
  extra?: Record<string, unknown>;
}

export interface ErrorReporter {
  readonly key: string;
  capture(error: Error, context?: ErrorContext): Promise<void>;
}

export type ReporterHttpClient = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** The default: an error nobody sent anywhere is still an error somebody can read. */
@Injectable()
export class LogErrorReporter implements ErrorReporter {
  readonly key = 'log';
  private readonly logger = new Logger('Errors');

  async capture(error: Error, context: ErrorContext = {}): Promise<void> {
    this.logger.error(
      {
        message: error.message,
        correlationId: context.correlationId,
        route: context.route,
        userId: context.userId,
        ...context.extra,
      },
      error.stack,
    );
  }
}

interface SentryDsn {
  protocol: string;
  publicKey: string;
  host: string;
  projectId: string;
}

/**
 * Posts an event to Sentry's store endpoint.
 *
 * Failures are swallowed: an error reporter that throws turns one incident into two,
 * and the log reporter has already recorded the original.
 */
@Injectable()
export class SentryErrorReporter implements ErrorReporter {
  readonly key = 'sentry';
  private readonly logger = new Logger(SentryErrorReporter.name);
  private readonly dsn: SentryDsn | null;
  private readonly environment: string;
  private readonly release: string;

  constructor(
    config: ConfigService,
    @Optional() private readonly http: ReporterHttpClient = (url, init) => fetch(url, init),
  ) {
    this.dsn = parseDsn(config.get<string>('SENTRY_DSN'));
    this.environment = config.get<string>('NODE_ENV') ?? 'development';
    this.release = config.get<string>('APP_VERSION') ?? 'dev';
  }

  get configured(): boolean {
    return this.dsn !== null;
  }

  async capture(error: Error, context: ErrorContext = {}): Promise<void> {
    if (!this.dsn) return;

    const event = {
      event_id: randomEventId(),
      timestamp: new Date().toISOString(),
      platform: 'node',
      level: 'error',
      environment: this.environment,
      release: this.release,
      logger: 'jecks',
      transaction: context.route,
      exception: {
        values: [
          {
            type: error.name,
            value: error.message,
            stacktrace: { frames: parseStack(error.stack) },
          },
        ],
      },
      tags: {
        correlation_id: context.correlationId ?? '',
        method: context.method ?? '',
      },
      user: context.userId ? { id: context.userId } : undefined,
      extra: context.extra,
    };

    const url = `${this.dsn.protocol}://${this.dsn.host}/api/${this.dsn.projectId}/store/`;

    try {
      const response = await this.http(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sentry-auth': [
            'Sentry sentry_version=7',
            'sentry_client=jecks/1.0',
            `sentry_key=${this.dsn.publicKey}`,
          ].join(', '),
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        this.logger.warn(`Sentry refused the event (${response.status})`);
      }
    } catch (cause) {
      this.logger.warn(`Could not reach Sentry: ${(cause as Error).message}`);
    }
  }
}

/**
 * Splits a DSN into its parts.
 *
 * Returns null for anything unparseable rather than throwing: a malformed DSN in an
 * environment file must not stop the API from booting.
 */
export function parseDsn(dsn: string | undefined): SentryDsn | null {
  if (!dsn?.trim()) return null;

  const match = /^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn.trim());
  if (!match) return null;

  const [, protocol, publicKey, host, projectId] = match;
  return {
    protocol: protocol!,
    // A DSN may carry a secret as `key:secret`; only the public half is sent.
    publicKey: publicKey!.split(':')[0]!,
    host: host!,
    projectId: projectId!,
  };
}

/** Sentry frames, innermost last, which is the opposite of a Node stack. */
export function parseStack(stack: string | undefined): Array<Record<string, unknown>> {
  if (!stack) return [];

  const frames = stack
    .split('\n')
    .slice(1)
    .map((line) => /at (?:(.+?) )?\(?(.+?):(\d+):(\d+)\)?$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      function: match[1] ?? '<anonymous>',
      filename: match[2],
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: !String(match[2]).includes('node_modules'),
    }));

  return frames.reverse();
}

function randomEventId(): string {
  // 32 hex characters, which is what Sentry expects of an event id.
  let id = '';
  for (let index = 0; index < 32; index += 1) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}
