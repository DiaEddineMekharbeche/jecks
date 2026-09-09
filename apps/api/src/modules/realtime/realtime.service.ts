import { Injectable, Logger } from '@nestjs/common';
import type { AdminEvent, AdminEventName } from '@jecks/shared';
import { Subject, type Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

interface Envelope {
  event: AdminEvent;
  /** When set, only subscribers holding one of these permissions receive it. */
  requires?: string[];
}

/**
 * Admin realtime — DECISIONS D12, Server-Sent Events rather than a socket, because the
 * traffic is one-directional: the server tells the admin that an order arrived.
 *
 * A single in-process subject fans out to every connection. That is correct for the
 * single-VPS target of PRD Section 10.10; a second API instance would need a Redis
 * pub/sub bridge here, and nothing else would change.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly stream = new Subject<Envelope>();
  private sequence = 0;
  private connections = 0;

  /**
   * Publishes to every admin whose permissions allow it. Never throws: a realtime
   * failure must not roll back the order that triggered it.
   */
  emit<T>(name: AdminEventName, payload: T, requires?: string[]): void {
    try {
      this.sequence += 1;
      this.stream.next({
        event: {
          name,
          id: String(this.sequence),
          at: new Date().toISOString(),
          payload,
        },
        requires,
      });
    } catch (error) {
      this.logger.warn(`Dropped realtime event ${name}: ${String(error)}`);
    }
  }

  /** Stream for one subscriber, filtered by what that user is allowed to see. */
  subscribe(permissions: string[]): Observable<AdminEvent> {
    const granted = new Set(permissions);
    return this.stream.pipe(
      filter((envelope) => {
        if (!envelope.requires || envelope.requires.length === 0) return true;
        return envelope.requires.some((permission) => granted.has(permission));
      }),
      map((envelope) => envelope.event),
    );
  }

  trackConnection(delta: 1 | -1): number {
    this.connections = Math.max(this.connections + delta, 0);
    return this.connections;
  }

  get connectionCount(): number {
    return this.connections;
  }
}
