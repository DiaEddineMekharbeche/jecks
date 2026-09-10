import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  callLogSchema,
  orderAddressPatchSchema,
  orderBulkSchema,
  orderNoteSchema,
  orderTagsSchema,
  orderTransitionSchema,
  type CallLogInput,
  type OrderAddressPatchInput,
  type OrderBulkInput,
  type OrderNoteInput,
  type OrderTagsInput,
  type OrderTransitionInput,
} from '@jecks/shared';
import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators.js';
import { AuditEntity } from '../../common/interceptors/audit.interceptor.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { OrdersAdminService } from './orders-admin.service.js';

/**
 * The order an agent works on — PRD F-AD-30 to F-AD-36.
 *
 * `orders.transition` is a separate permission from `orders.write` on purpose: an agent
 * may correct a phone number all day, and still not be the person who decides an order
 * is cancelled.
 */
@ApiTags('admin/orders')
@ApiBearerAuth()
@AuditEntity('order')
@Controller('admin/orders')
export class OrdersAdminController {
  constructor(private readonly orders: OrdersAdminService) {}

  @Get('counts')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Row counts per status, for the list tabs' })
  counts() {
    return this.orders.counts();
  }

  @Get(':id')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'One order with its items, timeline, notes and calls' })
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Post(':id/transition')
  @RequirePermissions('orders.transition')
  @ApiOperation({ summary: 'Move the order through the state machine' })
  transition(
    @Param('id') id: string,
    @Body(zod(orderTransitionSchema)) body: OrderTransitionInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.transition(id, body, { id: user.id, name: user.name });
  }

  @Post('bulk')
  @RequirePermissions('orders.transition')
  @ApiOperation({ summary: 'Apply one action to a selection, reporting each refusal' })
  bulk(
    @Body(zod(orderBulkSchema)) body: OrderBulkInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.bulk(body, { id: user.id, name: user.name });
  }

  @Post(':id/notes')
  @RequirePermissions('orders.write')
  @ApiOperation({ summary: 'Add an internal note' })
  addNote(
    @Param('id') id: string,
    @Body(zod(orderNoteSchema)) body: OrderNoteInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.addNote(id, body, { id: user.id, name: user.name });
  }

  @Post(':id/call-logs')
  @RequirePermissions('orders.write')
  @ApiOperation({ summary: 'Record a call, its outcome and any callback time' })
  logCall(
    @Param('id') id: string,
    @Body(zod(callLogSchema)) body: CallLogInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.logCall(id, body, { id: user.id, name: user.name });
  }

  @Patch(':id/tags')
  @RequirePermissions('orders.write')
  @ApiOperation({ summary: 'Replace the order tags' })
  setTags(@Param('id') id: string, @Body(zod(orderTagsSchema)) body: OrderTagsInput) {
    return this.orders.setTags(id, body);
  }

  @Patch(':id')
  @RequirePermissions('orders.write')
  @ApiOperation({ summary: 'Correct the customer and delivery details before packing' })
  update(
    @Param('id') id: string,
    @Body(zod(orderAddressPatchSchema)) body: OrderAddressPatchInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.updateAddress(id, body, { id: user.id, name: user.name });
  }

  @Post(':id/assign')
  @RequirePermissions('orders.write')
  @ApiOperation({ summary: 'Assign the order to an agent, or clear the assignment' })
  assign(@Param('id') id: string, @Body('agentId') agentId: string | null) {
    return this.orders.assign(id, agentId || null);
  }
}
