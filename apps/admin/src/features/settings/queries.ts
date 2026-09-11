import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import * as settings from './api';

/** Cache layer for the settings module. */

export const settingsKeys = {
  all: ['admin', 'settings'] as const,
  scopes: ['admin', 'settings', 'scopes'] as const,
  templates: ['admin', 'settings', 'templates'] as const,
  roles: ['admin', 'settings', 'roles'] as const,
  permissions: ['admin', 'settings', 'permissions'] as const,
  invitations: ['admin', 'settings', 'invitations'] as const,
  backups: ['admin', 'settings', 'backups'] as const,
  auditEntityTypes: ['admin', 'settings', 'audit-entity-types'] as const,
  queues: ['admin', 'settings', 'queues'] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.scopes,
    queryFn: settings.listSettings,
    staleTime: 60_000,
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: settingsKeys.templates,
    queryFn: settings.listTemplates,
    staleTime: 60_000,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: settingsKeys.roles,
    queryFn: settings.listRoles,
    staleTime: 5 * 60_000,
  });
}

export function usePermissionCatalogue() {
  return useQuery({
    queryKey: settingsKeys.permissions,
    queryFn: settings.listPermissions,
    // The catalogue only changes when the code does.
    staleTime: Infinity,
  });
}

export function useInvitations() {
  return useQuery({
    queryKey: settingsKeys.invitations,
    queryFn: settings.listInvitations,
    staleTime: 30_000,
  });
}

export function useAuditEntityTypes() {
  return useQuery({
    queryKey: settingsKeys.auditEntityTypes,
    queryFn: settings.listAuditEntityTypes,
    staleTime: 5 * 60_000,
  });
}

/** Polls while a dump is running, then settles. */
export function useBackups() {
  return useQuery({
    queryKey: settingsKeys.backups,
    queryFn: settings.listBackups,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((backup) => backup.status === 'running') ? 4_000 : false,
  });
}

/**
 * Queue state, refreshed every ten seconds.
 *
 * Somebody opens this screen because something is stuck, and watches it to see whether
 * it moves. A static snapshot would answer the wrong question.
 */
export function useQueues() {
  return useQuery({
    queryKey: settingsKeys.queues,
    queryFn: settings.readQueues,
    refetchInterval: 10_000,
  });
}

export function useSettingsInvalidate() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: settingsKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'staff'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  }, [queryClient]);
}
