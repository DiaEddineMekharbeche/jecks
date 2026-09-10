import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  adminListQuerySchema,
  blacklistSchema,
  customerCreateSchema,
  customerGroupInputSchema,
  customerMergeSchema,
  customerNoteSchema,
  customerPatchSchema,
  loyaltyAdjustSchema,
  type AdminListQuery,
  type BlacklistInput,
  type CustomerCreateInput,
  type CustomerGroupInput,
  type CustomerMergeInput,
  type CustomerNoteInput,
  type CustomerPatchInput,
  type LoyaltyAdjustInput,
} from '@jecks/shared';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  RawResponse,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators.js';
import { AuditEntity, NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { ExportService } from '../../common/list/export.service.js';
import { parseFilters } from '../../common/list/list.helper.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { CUSTOMER_EXPORT_COLUMNS, CustomersService } from './customers.service.js';
import { LoyaltyService } from './loyalty.service.js';

@ApiTags('admin/customers')
@ApiBearerAuth()
@AuditEntity('customer')
@Controller('admin/customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly loyalty: LoyaltyService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @RawResponse()
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'Customers with their value, reliability and segment' })
  @ApiQuery({ name: 'filter[segment]', required: false, isArray: true })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>);

    if (query.format) {
      const rows = await this.customers.listForExport(query, filters);
      await this.exporter.stream(response, query.format, 'clients', CUSTOMER_EXPORT_COLUMNS, rows);
      return;
    }

    response.json(await this.customers.list(query, filters));
  }

  @Get('segments')
  @NoAudit()
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'How many customers are in each segment, and what they are worth' })
  segments() {
    return this.customers.segments();
  }

  @Get('groups')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'Customer groups and their pricing' })
  groups() {
    return this.customers.listGroups();
  }

  @Post('groups')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'Create a group' })
  createGroup(@Body(zod(customerGroupInputSchema)) body: CustomerGroupInput) {
    return this.customers.createGroup(body);
  }

  @Patch('groups/:id')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'Update a group' })
  updateGroup(@Param('id') id: string, @Body(zod(customerGroupInputSchema)) body: CustomerGroupInput) {
    return this.customers.updateGroup(id, body);
  }

  @Delete('groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'Delete an empty group' })
  async removeGroup(@Param('id') id: string): Promise<void> {
    await this.customers.removeGroup(id);
  }

  /**
   * What a merge would move.
   *
   * Read-only and separate from the merge itself, because the operation cannot be
   * undone and nobody should discover its size afterwards.
   */
  @Get('merge-preview')
  @NoAudit()
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'What merging one customer into another would move' })
  preview(@Query('keepId') keepId: string, @Query('mergeId') mergeId: string) {
    return this.customers.previewMerge(keepId, mergeId);
  }

  @Post('merge')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'Merge two records of the same person' })
  merge(@Body(zod(customerMergeSchema)) body: CustomerMergeInput) {
    return this.customers.merge(body);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'One customer with orders, addresses, notes and points' })
  get(@Param('id') id: string) {
    return this.customers.get(id);
  }

  @Post()
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'Add a customer by hand, for an order taken over the counter' })
  create(@Body(zod(customerCreateSchema)) body: CustomerCreateInput) {
    return this.customers.create(body);
  }

  @Patch(':id')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'Update a customer' })
  update(@Param('id') id: string, @Body(zod(customerPatchSchema)) body: CustomerPatchInput) {
    return this.customers.update(id, body);
  }

  @Post(':id/notes')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'Add an internal note' })
  note(
    @Param('id') id: string,
    @Body(zod(customerNoteSchema)) body: CustomerNoteInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.addNote(id, body, user.id);
  }

  @Post(':id/blacklist')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'Block or unblock a customer; blocking takes a reason' })
  blacklist(@Param('id') id: string, @Body(zod(blacklistSchema)) body: BlacklistInput) {
    return this.customers.setBlacklisted(id, body);
  }

  @Post(':id/loyalty')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'Adjust a points balance by hand, with a reason' })
  adjustLoyalty(@Param('id') id: string, @Body(zod(loyaltyAdjustSchema)) body: LoyaltyAdjustInput) {
    return this.loyalty.adjust(id, body);
  }

  @Post(':id/refresh')
  @NoAudit()
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'Recompute the cached rollups from the orders' })
  async refresh(@Param('id') id: string) {
    await this.customers.refreshRollups(id);
    return this.customers.get(id);
  }
}
