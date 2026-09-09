import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { globalSearchQuerySchema } from '@jecks/shared';
import type { z } from 'zod';
import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { GlobalSearchService } from './global-search.service.js';

@ApiTags('admin/search')
@ApiBearerAuth()
@Controller('admin/search')
export class GlobalSearchController {
  constructor(private readonly search: GlobalSearchService) {}

  /**
   * Results are filtered by the caller's permissions inside the service, so an order
   * agent's palette never surfaces a customer's lifetime value.
   */
  @Get()
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Cross-entity search for the command palette' })
  find(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zod(globalSearchQuerySchema)) query: z.infer<typeof globalSearchQuerySchema>,
  ) {
    return this.search.search(query.q, query.limit, user.permissions);
  }
}
