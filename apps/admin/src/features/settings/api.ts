import type {
  AcceptInvitationInput,
  BackupRow,
  NotificationTemplateDto,
  NotificationTemplateInput,
  PermissionDto,
  RoleDto,
  RoleInput,
  SettingsScopeDto,
  StaffInvitationRow,
  StaffInviteInput,
  StaffRow,
  StaffUpdateInput,
  TemplateTestInput,
} from '@jecks/shared';
import { api } from '@/lib/api';

/** Every call the settings, users, roles, journal and backup screens make. */

// --- settings ---------------------------------------------------------------

export const listSettings = () => api<SettingsScopeDto[]>('/admin/settings');

export const getSettingsScope = (scope: string) =>
  api<SettingsScopeDto>(`/admin/settings/${scope}`);

export const updateSettingsScope = (scope: string, values: Record<string, unknown>) =>
  api<SettingsScopeDto>(`/admin/settings/${scope}`, { method: 'PATCH', body: values });

// --- notification templates -------------------------------------------------

export const listTemplates = () => api<NotificationTemplateDto[]>('/admin/settings/templates');

export const saveTemplate = (body: NotificationTemplateInput | Record<string, unknown>) =>
  api<NotificationTemplateDto>('/admin/settings/templates', { method: 'POST', body });

export const previewTemplate = (id: string, locale: string) =>
  api<{ subject: string | null; body: string }>(`/admin/settings/templates/${id}/preview`, {
    query: { locale },
  });

export const testTemplate = (id: string, body: TemplateTestInput) =>
  api<{ queued: boolean }>(`/admin/settings/templates/${id}/test`, { method: 'POST', body });

export const deleteTemplate = (id: string) =>
  api<void>(`/admin/settings/templates/${id}`, { method: 'DELETE' });

// --- users ------------------------------------------------------------------

export const getStaff = (id: string) => api<StaffRow>(`/admin/users/${id}`);

export const updateStaff = (id: string, body: StaffUpdateInput | Record<string, unknown>) =>
  api<StaffRow>(`/admin/users/${id}`, { method: 'PATCH', body });

export const setStaffPassword = (id: string, password: string) =>
  api<{ ok: true }>(`/admin/users/${id}/password`, { method: 'POST', body: { password } });

export const revokeStaffSessions = (id: string) =>
  api<{ revoked: number }>(`/admin/users/${id}/sessions/revoke`, { method: 'POST' });

export const resetStaffTwoFactor = (id: string) =>
  api<StaffRow>(`/admin/users/${id}/two-factor/reset`, { method: 'POST' });

export const deactivateStaff = (id: string) =>
  api<void>(`/admin/users/${id}`, { method: 'DELETE' });

export const listInvitations = () => api<StaffInvitationRow[]>('/admin/users/invitations');

export const inviteStaff = (body: StaffInviteInput) =>
  api<{ invitation: StaffInvitationRow; token: string }>('/admin/users/invitations', {
    method: 'POST',
    body,
  });

export const revokeInvitation = (id: string) =>
  api<void>(`/admin/users/invitations/${id}`, { method: 'DELETE' });

export const acceptInvitation = (body: AcceptInvitationInput) =>
  api<{ email: string }>('/auth/invitations/accept', { method: 'POST', body });

// --- roles ------------------------------------------------------------------

export const listRoles = () => api<RoleDto[]>('/admin/roles');

export const listPermissions = () => api<PermissionDto[]>('/admin/roles/permissions');

export const createRole = (body: RoleInput | Record<string, unknown>) =>
  api<RoleDto>('/admin/roles', { method: 'POST', body });

export const updateRole = (id: string, body: RoleInput | Record<string, unknown>) =>
  api<RoleDto>(`/admin/roles/${id}`, { method: 'PATCH', body });

export const updateRolePermissions = (id: string, permissions: string[]) =>
  api<RoleDto>(`/admin/roles/${id}/permissions`, { method: 'PATCH', body: { permissions } });

export const deleteRole = (id: string) => api<void>(`/admin/roles/${id}`, { method: 'DELETE' });

// --- audit ------------------------------------------------------------------

export const listAuditEntityTypes = () => api<string[]>('/admin/audit/entity-types');

// --- backups ----------------------------------------------------------------

export const listBackups = () => api<BackupRow[]>('/admin/backups');

export const triggerBackup = () => api<BackupRow>('/admin/backups', { method: 'POST' });

// --- queues -----------------------------------------------------------------

export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  scheduled: number;
}

export interface FailedJob {
  queue: string;
  id: string;
  name: string;
  reason: string;
  attempts: number;
  failedAt: string | null;
}

export interface QueueState {
  reachable: boolean;
  queues: QueueCounts[];
  failures: FailedJob[];
}

export const readQueues = () => api<QueueState>('/admin/ops/queues');

export const retryJob = (queue: string, jobId: string) =>
  api<{ retried: boolean }>('/admin/ops/queues/retry', {
    method: 'POST',
    body: { queue, jobId },
  });

// --- payment providers ------------------------------------------------------

export interface PaymentProviderRow {
  key: string;
  label: string;
  redirects: boolean;
  configured: boolean;
}

export const listPaymentProviders = () =>
  api<PaymentProviderRow[]>('/admin/payments/providers');

export const testPaymentProvider = (key: string) =>
  api<{ ok: boolean; message: string }>(`/admin/payments/providers/${key}/test`, {
    method: 'POST',
  });
