import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { adminListQuerySchema, type AdminListQuery } from '@jecks/shared';
import type { Request, Response } from 'express';
import {
  RawResponse,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { ExportService } from '../../common/list/export.service.js';
import { parseFilters } from '../../common/list/list.helper.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import {
  ORDER_EXPORT_COLUMNS,
  OrdersListService,
  type OrderListFilters,
} from './orders-list.service.js';

@ApiTags('admin/orders')
@ApiBearerAuth()
@Controller('admin/orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersListService,
    private readonly exporter: ExportService,
  ) {}

  /**
   * One endpoint serves the table and the export: same filters, same sort, same
   * permissions. `format` switches the representation, so the file a user downloads
   * always matches the rows they were looking at.
   */
  @Get()
  @RawResponse()
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Orders list, or a CSV/XLSX export of the same filter set' })
  @ApiQuery({ name: 'filter[status]', required: false, isArray: true })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'xlsx'] })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>) as OrderListFilters;

    if (query.format) {
      const rows = await this.orders.listForExport(query, filters);
      await this.exporter.stream(response, query.format, 'commandes', ORDER_EXPORT_COLUMNS, rows);
      return;
    }

    // @RawResponse opts this route out of the envelope interceptor so the export can
    // stream, which means the JSON envelope is written by hand here.
    const result = await this.orders.list(query, filters);
    response.json({
      data: JSON.parse(
        JSON.stringify(result.data, (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
      ),
      meta: result.meta,
    });
  }

  @Get('counts')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Per-status counters for the list tabs' })
  counts(@Req() request: Request) {
    const filters = parseFilters(request.query as Record<string, unknown>) as OrderListFilters;
    return this.orders.statusCounts(filters);
  }
}
