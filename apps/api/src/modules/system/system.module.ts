import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { BackupsService } from './backups.service.js';
import { NotificationTemplatesService } from './notification-templates.service.js';
import { RolesService } from './roles.service.js';
import { SettingsAdminService } from './settings-admin.service.js';
import {
  AuditController,
  BackupsController,
  InvitationsController,
  RolesController,
  SettingsAdminController,
  UsersController,
} from './system.controller.js';
import { UsersService } from './users.service.js';

/**
 * Settings, users, roles, audit and backups — PRD F-AD-91 to F-AD-93.
 *
 * `SettingsAdminService` is exported because it owns the decryption of stored
 * credentials, and every integration that needs one (SMS in M3, couriers in M4,
 * payments in M3.2) must go through it rather than reading the table itself.
 */
@Module({
  controllers: [
    SettingsAdminController,
    UsersController,
    InvitationsController,
    RolesController,
    AuditController,
    BackupsController,
  ],
  providers: [
    SettingsAdminService,
    UsersService,
    RolesService,
    AuditService,
    BackupsService,
    NotificationTemplatesService,
  ],
  exports: [SettingsAdminService, AuditService, NotificationTemplatesService],
})
export class SystemModule {}
