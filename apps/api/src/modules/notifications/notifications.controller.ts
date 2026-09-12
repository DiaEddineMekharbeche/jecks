import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/auth.decorators.js';
import { NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { NotificationsService } from './notifications.service.js';

/**
 * The signed-in user's own notifications — PRD Section 6.1.
 *
 * Under `/me` rather than `/admin` deliberately. Every other admin route names a
 * permission because it reaches a shop resource that some roles may not see; this one
 * only ever returns rows addressed to the caller or to nobody, so there is no
 * permission that would mean anything here. Putting it under `/admin` would force a
 * borrowed permission — `orders.read`, say — and then an agent's own inbox would depend
 * on whether they could read orders.
 *
 * It is still behind the global auth guard: signed out, it is a 401 like everything else.
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @NoAudit()
  @ApiOperation({ summary: 'Recent in-app notifications, with the unread count' })
  feed(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.feed(user.id);
  }

  @Get('count')
  @NoAudit()
  @ApiOperation({ summary: 'Just the unread count, for the badge' })
  count(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @NoAudit()
  @ApiOperation({ summary: 'Mark one as read' })
  read(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @NoAudit()
  @ApiOperation({ summary: 'Clear the badge' })
  readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }
}
