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
  bulkCodeSchema,
  promotionInputSchema,
  promotionSimulateSchema,
  type AdminListQuery,
  type BulkCodeInput,
  type PromotionInput,
  type PromotionSimulateInput,
} from '@jecks/shared';
import type { Request, Response } from 'express';
import { RawResponse, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { AuditEntity, NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { ExportService } from '../../common/list/export.service.js';
import { parseFilters } from '../../common/list/list.helper.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import {
  PROMOTION_EXPORT_COLUMNS,
  PromotionsAdminService,
} from './promotions-admin.service.js';

/** Promotions — PRD F-AD-20/21. */
@ApiTags('admin/promotions')
@ApiBearerAuth()
@AuditEntity('promotion')
@Controller('admin/promotions')
export class PromotionsController {
  constructor(
    private readonly promotions: PromotionsAdminService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @RawResponse()
  @RequirePermissions('promotions.read')
  @ApiOperation({ summary: 'Promotions with their usage and what they gave away' })
  @ApiQuery({ name: 'filter[state]', required: false, isArray: true })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>);

    if (query.format) {
      const rows = await this.promotions.listForExport(query, filters);
      await this.exporter.stream(response, query.format, 'promotions', PROMOTION_EXPORT_COLUMNS, rows);
      return;
    }

    response.json(await this.promotions.list(query, filters));
  }

  @Get('counts')
  @RequirePermissions('promotions.read')
  @ApiOperation({ summary: 'Row counts per state, for the list tabs' })
  counts() {
    return this.promotions.counts();
  }

  /**
   * Runs the live engine against a hand-built cart — PRD F-AD-21.
   *
   * `@NoAudit` because it changes nothing: auditing a simulation would bury the writes
   * that matter under the owner's experiments.
   */
  @Post('simulate')
  @NoAudit()
  @RequirePermissions('promotions.read')
  @ApiOperation({ summary: 'Simulate a cart through the real promotion engine' })
  simulate(@Body(zod(promotionSimulateSchema)) body: PromotionSimulateInput) {
    return this.promotions.simulate({
      variantIds: body.variantIds,
      codes: body.codes,
      wilayaCode: body.wilayaCode ?? null,
      customerId: body.customerId ?? null,
      shippingMinor: body.shippingMinor,
    });
  }

  @Get(':id')
  @RequirePermissions('promotions.read')
  @ApiOperation({ summary: 'One promotion with its conditions and targets' })
  get(@Param('id') id: string) {
    return this.promotions.get(id);
  }

  @Get(':id/performance')
  @RequirePermissions('promotions.read')
  @ApiOperation({ summary: 'Uses, discount granted, revenue and margin, from real orders' })
  performance(@Param('id') id: string) {
    return this.promotions.performance(id);
  }

  @Get(':id/codes')
  @RequirePermissions('promotions.read')
  @ApiOperation({ summary: 'The unique codes generated for this promotion' })
  codes(@Param('id') id: string) {
    return this.promotions.listCodes(id);
  }

  @Post()
  @RequirePermissions('promotions.write')
  @ApiOperation({ summary: 'Create a promotion' })
  create(@Body(zod(promotionInputSchema)) body: PromotionInput) {
    return this.promotions.create(body);
  }

  @Patch(':id')
  @RequirePermissions('promotions.write')
  @ApiOperation({ summary: 'Update a promotion' })
  update(@Param('id') id: string, @Body(zod(promotionInputSchema)) body: PromotionInput) {
    return this.promotions.update(id, body);
  }

  @Post(':id/activate')
  @RequirePermissions('promotions.write')
  @ApiOperation({ summary: 'Switch a promotion on or off without editing it' })
  activate(@Param('id') id: string, @Body('active') active: boolean) {
    return this.promotions.setActive(id, active !== false);
  }

  @Post(':id/codes/generate')
  @RequirePermissions('promotions.write')
  @ApiOperation({ summary: 'Generate unique single-use codes in bulk' })
  generate(@Param('id') id: string, @Body(zod(bulkCodeSchema)) body: BulkCodeInput) {
    return this.promotions.generateCodes(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('promotions.write')
  @ApiOperation({ summary: 'Archive a promotion, keeping its usage history' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.promotions.remove(id);
  }
}
