import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  savedViewInputSchema,
  savedViewUpdateSchema,
  type SavedViewInput,
} from '@jecks/shared';
import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators.js';
import { NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { ViewsService } from './views.service.js';

@ApiTags('admin/views')
@ApiBearerAuth()
@Controller('admin/views')
// A saved filter is a personal preference, not a business change; auditing every one
// would drown the log the owner actually reads.
@NoAudit()
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Get()
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Saved list views for the signed-in user, plus shared ones' })
  list(@CurrentUser() user: AuthenticatedUser, @Query('module') module?: string) {
    return this.views.list(user.id, module);
  }

  @Post()
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Save the current list state as a named view' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zod(savedViewInputSchema)) body: SavedViewInput,
  ) {
    return this.views.create(user.id, body);
  }

  @Patch(':id')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Rename, re-save or share a view' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zod(savedViewUpdateSchema)) body: Partial<Omit<SavedViewInput, 'module'>>,
  ) {
    return this.views.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Delete one of your views' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.views.remove(user.id, id);
  }
}
