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
import { Throttle } from '@nestjs/throttler';
import {
  acceptInvitationSchema,
  adminListQuerySchema,
  notificationTemplateSchema,
  roleInputSchema,
  rolePermissionsSchema,
  staffInviteSchema,
  staffPasswordSchema,
  staffUpdateSchema,
  templateTestSchema,
  type AcceptInvitationInput,
  type AdminListQuery,
  type AuditListFilters,
  type NotificationTemplateInput,
  type RoleInput,
  type StaffInviteInput,
  type StaffPasswordInput,
  type StaffUpdateInput,
  type TemplateTestInput,
} from '@jecks/shared';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  Public,
  RawResponse,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators.js';
import { AuditEntity, NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { ExportService } from '../../common/list/export.service.js';
import { parseFilters } from '../../common/list/list.helper.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { AUDIT_EXPORT_COLUMNS, AuditService } from './audit.service.js';
import { BackupsService } from './backups.service.js';
import { NotificationTemplatesService } from './notification-templates.service.js';
import { RolesService } from './roles.service.js';
import { SettingsAdminService } from './settings-admin.service.js';
import { UsersService } from './users.service.js';

/** Settings — PRD F-AD-91. */
@ApiTags('admin/settings')
@ApiBearerAuth()
@AuditEntity('setting')
@Controller('admin/settings')
export class SettingsAdminController {
  constructor(
    private readonly settings: SettingsAdminService,
    private readonly templates: NotificationTemplatesService,
  ) {}

  @Get()
  @RequirePermissions('settings.read')
  @ApiOperation({ summary: 'Every settings scope, secrets masked' })
  all() {
    return this.settings.all();
  }

  @Get('templates')
  @RequirePermissions('settings.read')
  @ApiOperation({ summary: 'Notification templates, one per event and channel' })
  templateList() {
    return this.templates.list();
  }

  @Post('templates')
  @RequirePermissions('settings.write')
  @ApiOperation({ summary: 'Create or replace the template for an event and channel' })
  saveTemplate(@Body(zod(notificationTemplateSchema)) body: NotificationTemplateInput) {
    return this.templates.save(body);
  }

  @Get('templates/:id/preview')
  @NoAudit()
  @RequirePermissions('settings.read')
  @ApiOperation({ summary: 'Render a template with sample values' })
  previewTemplate(@Param('id') id: string, @Query('locale') locale?: 'fr' | 'ar' | 'en') {
    return this.templates.preview(id, locale ?? 'fr');
  }

  @Post('templates/:id/test')
  @RequirePermissions('settings.write')
  @ApiOperation({ summary: 'Queue one real send to a chosen recipient' })
  testTemplate(
    @Param('id') id: string,
    @Body(zod(templateTestSchema)) body: TemplateTestInput,
  ) {
    return this.templates.test(id, body);
  }

  @Delete('templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('settings.write')
  @ApiOperation({ summary: 'Delete a template, falling back to the built-in copy' })
  async removeTemplate(@Param('id') id: string): Promise<void> {
    await this.templates.remove(id);
  }

  @Get(':scope')
  @RequirePermissions('settings.read')
  @ApiOperation({ summary: 'One settings scope' })
  scope(@Param('scope') scope: string) {
    return this.settings.scope(scope);
  }

  /**
   * Partial by design: the admin sends only the keys that changed, which keeps the
   * audit diff readable and makes two people editing different sections safe.
   */
  @Patch(':scope')
  @RequirePermissions('settings.write')
  @ApiOperation({ summary: 'Update the keys of one scope' })
  update(@Param('scope') scope: string, @Body() body: Record<string, unknown>) {
    return this.settings.update(scope, body);
  }
}

/** Staff accounts and invitations — PRD F-AD-92. */
@ApiTags('admin/users')
@ApiBearerAuth()
@AuditEntity('user')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Staff members with their roles and live session counts' })
  @ApiQuery({ name: 'filter[active]', required: false })
  list(@Query(zod(adminListQuerySchema)) query: AdminListQuery, @Req() request: Request) {
    return this.users.list(query, parseFilters(request.query as Record<string, unknown>));
  }

  @Get('invitations')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Pending and past invitations' })
  invitations() {
    return this.users.listInvitations();
  }

  @Post('invitations')
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Invite a colleague; returns the one-time link' })
  invite(
    @Body(zod(staffInviteSchema)) body: StaffInviteInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.invite(body, user.id);
  }

  @Delete('invitations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Revoke an invitation' })
  async revokeInvitation(@Param('id') id: string): Promise<void> {
    await this.users.revokeInvitation(id);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'One staff member' })
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Rename, re-role, or deactivate a staff member' })
  update(
    @Param('id') id: string,
    @Body(zod(staffUpdateSchema)) body: StaffUpdateInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.update(id, body, user.id);
  }

  @Post(':id/password')
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Set a password directly, for an account with no e-mail' })
  setPassword(@Param('id') id: string, @Body(zod(staffPasswordSchema)) body: StaffPasswordInput) {
    return this.users.setPassword(id, body);
  }

  @Post(':id/sessions/revoke')
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Sign this staff member out everywhere' })
  revokeSessions(@Param('id') id: string) {
    return this.users.revokeSessions(id);
  }

  @Post(':id/two-factor/reset')
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Clear the second factor so they can enrol again' })
  resetTwoFactor(@Param('id') id: string) {
    return this.users.resetTwoFactor(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Deactivate and archive a staff account' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.users.deactivate(id, user.id);
  }
}

/** Accepting an invitation happens before the invitee has any credentials. */
@ApiTags('auth')
@Controller('auth/invitations')
export class InvitationsController {
  constructor(private readonly users: UsersService) {}

  @Post('accept')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Set a password and activate an invited staff account' })
  accept(@Body(zod(acceptInvitationSchema)) body: AcceptInvitationInput) {
    return this.users.acceptInvitation(body);
  }
}

/** Roles and the permission matrix — PRD F-AD-92. */
@ApiTags('admin/roles')
@ApiBearerAuth()
@AuditEntity('role')
@Controller('admin/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Every role with its permissions and headcount' })
  list() {
    return this.roles.list();
  }

  @Get('permissions')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'The permission catalogue the matrix draws' })
  permissions() {
    return this.roles.permissions();
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'One role' })
  get(@Param('id') id: string) {
    return this.roles.get(id);
  }

  @Post()
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Create a custom role' })
  create(@Body(zod(roleInputSchema)) body: RoleInput) {
    return this.roles.create(body);
  }

  @Patch(':id')
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Rename a custom role or change any role permissions' })
  update(@Param('id') id: string, @Body(zod(roleInputSchema)) body: RoleInput) {
    return this.roles.update(id, body);
  }

  @Patch(':id/permissions')
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Replace the permission set of one role' })
  updatePermissions(
    @Param('id') id: string,
    @Body(zod(rolePermissionsSchema)) body: { permissions: RoleInput['permissions'] },
  ) {
    return this.roles.updatePermissions(id, body.permissions);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Delete an unused custom role' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.roles.remove(id);
  }
}

/** The audit log — PRD F-AD-93. Read-only: only the interceptor writes rows. */
@ApiTags('admin/audit')
@ApiBearerAuth()
@Controller('admin/audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @RawResponse()
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Every recorded change, newest first; exports' })
  @ApiQuery({ name: 'filter[entityType]', required: false, isArray: true })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>) as AuditListFilters;

    if (query.format) {
      const rows = await this.audit.listForExport(query, filters);
      await this.exporter.stream(response, query.format, 'journal', AUDIT_EXPORT_COLUMNS, rows);
      return;
    }

    response.json(await this.audit.list(query, filters));
  }

  @Get('entity-types')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'The entity types that actually appear in the log' })
  entityTypes() {
    return this.audit.entityTypes();
  }

  @Get(':entityType/:entityId')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'The history of one record, for an editor history tab' })
  forEntity(@Param('entityType') entityType: string, @Param('entityId') entityId: string) {
    return this.audit.forEntity(entityType, entityId);
  }
}

/** Database backups — PRD Section 10.10. */
@ApiTags('admin/backups')
@ApiBearerAuth()
@AuditEntity('backup')
@Controller('admin/backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  @RequirePermissions('settings.read')
  @ApiOperation({ summary: 'Recent backups with their size and download link' })
  list() {
    return this.backups.list();
  }

  @Post()
  @RequirePermissions('settings.write')
  @ApiOperation({ summary: 'Queue a dump now' })
  trigger(@CurrentUser() user: AuthenticatedUser) {
    return this.backups.trigger(user.id);
  }

  @Get(':id')
  @RequirePermissions('settings.read')
  @ApiOperation({ summary: 'One backup, for polling while it runs' })
  get(@Param('id') id: string) {
    return this.backups.get(id);
  }
}

