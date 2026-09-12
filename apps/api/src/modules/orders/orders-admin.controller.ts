import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  callLogSchema,
  orderAddressPatchSchema,
  orderBulkSchema,
  orderNoteSchema,
  orderTagsSchema,
  orderDocumentBatchSchema,
  orderTransitionSchema,
  type CallLogInput,
  type OrderAddressPatchInput,
  type OrderBulkInput,
  type OrderNoteInput,
  type OrderTagsInput,
  type OrderDocumentBatchInput,
  type OrderTransitionInput,
  type Permission,
} from '@jecks/shared';
import type { Response } from 'express';
import {
  CurrentUser,
  RawResponse,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators.js';
import { AuditEntity, NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { OrderDocumentsService } from './order-documents.service.js';
import { OrdersAdminService } from './orders-admin.service.js';

/**
 * The order an agent works on — PRD F-AD-30 to F-AD-36.
 *
 * `orders.transition` is a separate permission from `orders.write` on purpose: an agent
 * may correct a phone number all day, and still not be the person who decides an order
 * is cancelled.
 */
/**
 * Targets that need a permission beyond `orders.transition`.
 *
 * Both already existed in the catalogue and were granted to roles; neither was read by
 * anything until now.
 */
const EXTRA_PERMISSION: Partial<Record<string, Permission>> = {
  CANCELLED: 'orders.cancel',
  REFUNDED: 'orders.refund',
};

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

  /**
   * Moving an order along needs `orders.transition`; ending it needs more.
   *
   * Cancelling and refunding have their own permissions in the catalogue, and until
   * this check existed nothing read them: a warehouse hand with `orders.transition` for
   * marking boxes packed could cancel a customer's order. Two words of a route guard
   * cannot express "this target, not that one", so the target decides here.
   */
  @Post(':id/transition')
  @RequirePermissions('orders.transition')
  @ApiOperation({ summary: 'Move the order through the state machine' })
  transition(
    @Param('id') id: string,
    @Body(zod(orderTransitionSchema)) body: OrderTransitionInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const extra = EXTRA_PERMISSION[body.to];
    if (extra && !user.permissions.includes(extra)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Votre rôle ne permet pas cette action (${extra}).`,
      });
    }

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

/**
 * Printable order documents — PRD F-AD-36.
 *
 * A separate controller because these stream files rather than JSON, and because the
 * batch form is the one an owner actually uses: confirm the morning's orders, print the
 * invoices and the packing slips in two clicks.
 */
@ApiTags('admin/orders')
@ApiBearerAuth()
@Controller('admin/orders')
export class OrderDocumentsController {
  constructor(private readonly documents: OrderDocumentsService) {}

  @Get(':id/documents/invoice.pdf')
  @RawResponse()
  @NoAudit()
  @RequirePermissions('orders.documents')
  @ApiOperation({ summary: 'The invoice for one order' })
  async invoice(@Param('id') id: string, @Res() response: Response): Promise<void> {
    send(response, await this.documents.invoices([id]), 'facture.pdf');
  }

  @Get(':id/documents/packing-slip.pdf')
  @RawResponse()
  @NoAudit()
  @RequirePermissions('orders.documents')
  @ApiOperation({ summary: 'The packing slip for one order' })
  async packingSlip(@Param('id') id: string, @Res() response: Response): Promise<void> {
    send(response, await this.documents.packingSlips([id]), 'bon-de-preparation.pdf');
  }

  @Post('documents/batch')
  @HttpCode(HttpStatus.OK)
  @RawResponse()
  @NoAudit()
  @RequirePermissions('orders.documents')
  @ApiOperation({ summary: 'Invoices or packing slips for a batch, one order per page' })
  async batch(
    @Body(zod(orderDocumentBatchSchema)) body: OrderDocumentBatchInput,
    @Res() response: Response,
  ): Promise<void> {
    const pdf =
      body.kind === 'invoice'
        ? await this.documents.invoices(body.orderIds)
        : await this.documents.packingSlips(body.orderIds);

    send(response, pdf, body.kind === 'invoice' ? 'factures.pdf' : 'bons-de-preparation.pdf');
  }
}

/**
 * Streams a PDF.
 *
 * `no-store` because these carry a customer's name, address and phone, and a shared
 * office machine should not keep them in its browser cache.
 */
function send(response: Response, pdf: Buffer, filename: string): void {
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  response.setHeader('Cache-Control', 'no-store');
  response.end(pdf);
}
