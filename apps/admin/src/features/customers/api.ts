import type {
  BlacklistInput,
  CustomerCreateInput,
  CustomerDetail,
  CustomerGroupDto,
  CustomerGroupInput,
  CustomerMergeInput,
  CustomerNoteInput,
  CustomerPatchInput,
  LoyaltyAdjustInput,
  MergePreview,
  SegmentSummary,
} from '@jecks/shared';
import { api } from '@/lib/api';

/** Every call the customer screens make — PRD F-AD-40 to F-AD-42. */

export const getCustomer = (id: string) => api<CustomerDetail>(`/admin/customers/${id}`);

export const segments = () => api<SegmentSummary[]>('/admin/customers/segments');

export const createCustomer = (body: CustomerCreateInput | Record<string, unknown>) =>
  api<CustomerDetail>('/admin/customers', { method: 'POST', body });

export const updateCustomer = (id: string, body: CustomerPatchInput | Record<string, unknown>) =>
  api<CustomerDetail>(`/admin/customers/${id}`, { method: 'PATCH', body });

export const addNote = (id: string, body: CustomerNoteInput | Record<string, unknown>) =>
  api<CustomerDetail>(`/admin/customers/${id}/notes`, { method: 'POST', body });

export const setBlacklisted = (id: string, body: BlacklistInput | Record<string, unknown>) =>
  api<CustomerDetail>(`/admin/customers/${id}/blacklist`, { method: 'POST', body });

export const adjustLoyalty = (id: string, body: LoyaltyAdjustInput | Record<string, unknown>) =>
  api<{ balance: number }>(`/admin/customers/${id}/loyalty`, { method: 'POST', body });

export const refreshRollups = (id: string) =>
  api<CustomerDetail>(`/admin/customers/${id}/refresh`, { method: 'POST' });

export const mergePreview = (keepId: string, mergeId: string) =>
  api<MergePreview>('/admin/customers/merge-preview', { query: { keepId, mergeId } });

export const merge = (body: CustomerMergeInput | Record<string, unknown>) =>
  api<CustomerDetail>('/admin/customers/merge', { method: 'POST', body });

export const listGroups = () => api<CustomerGroupDto[]>('/admin/customers/groups');

export const createGroup = (body: CustomerGroupInput | Record<string, unknown>) =>
  api<CustomerGroupDto>('/admin/customers/groups', { method: 'POST', body });

export const updateGroup = (id: string, body: CustomerGroupInput | Record<string, unknown>) =>
  api<CustomerGroupDto>(`/admin/customers/groups/${id}`, { method: 'PATCH', body });

export const deleteGroup = (id: string) =>
  api<void>(`/admin/customers/groups/${id}`, { method: 'DELETE' });
