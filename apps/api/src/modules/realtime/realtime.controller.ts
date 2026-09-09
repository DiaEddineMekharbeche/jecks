import { Controller, Sse, MessageEvent } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { interval, merge, Observable } from 'rxjs';
import { finalize, map, startWith } from 'rxjs/operators';
import {
  CurrentUser,
  RawResponse,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators.js';
import { RealtimeService } from './realtime.service.js';

/** Keeps proxies and load balancers from closing an idle stream. */
const HEARTBEAT_MS = 25_000;

@ApiTags('admin/realtime')
@ApiBearerAuth()
@Controller('admin/events')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  /**
   * One long-lived response per admin tab. Nest handles the SSE framing; the
   * heartbeat and the permission filter are ours.
   */
  @Sse()
  @RawResponse()
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Server-sent stream of admin events' })
  stream(@CurrentUser() user: AuthenticatedUser): Observable<MessageEvent> {
    this.realtime.trackConnection(1);

    const events = this.realtime.subscribe(user.permissions).pipe(
      map((event): MessageEvent => ({ id: event.id, type: event.name, data: event })),
    );

    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: { at: new Date().toISOString() } })),
    );

    // The first frame arrives immediately, so the client knows it is connected rather
    // than waiting up to 25 seconds for the first heartbeat.
    const hello: MessageEvent = {
      type: 'connected',
      data: { at: new Date().toISOString(), user: user.id },
    };

    return merge(events, heartbeat).pipe(
      startWith(hello),
      finalize(() => this.realtime.trackConnection(-1)),
    );
  }
}
