import type {
  CallLogInput,
  OrderAddressPatchInput,
  OrderBulkInput,
  OrderBulkResult,
  OrderDetail,
  OrderNoteInput,
  OrderTagsInput,
  OrderTransitionInput,
} from '@jecks/shared';
import { api } from '@/lib/api';

/** Every call the order screens make — PRD F-AD-30 to F-AD-36. */

export const getOrder = (id: string) => api<OrderDetail>(`/admin/orders/${id}`);

export const getOrderCounts = () => api<Record<string, number>>('/admin/orders/counts');

export const transitionOrder = (id: string, body: OrderTransitionInput | Record<string, unknown>) =>
  api<OrderDetail>(`/admin/orders/${id}/transition`, { method: 'POST', body });

export const bulkOrders = (body: OrderBulkInput) =>
  api<OrderBulkResult>('/admin/orders/bulk', { method: 'POST', body });

export const addOrderNote = (id: string, body: OrderNoteInput) =>
  api<OrderDetail>(`/admin/orders/${id}/notes`, { method: 'POST', body });

export const logCall = (id: string, body: CallLogInput | Record<string, unknown>) =>
  api<OrderDetail>(`/admin/orders/${id}/call-logs`, { method: 'POST', body });

export const setOrderTags = (id: string, body: OrderTagsInput) =>
  api<OrderDetail>(`/admin/orders/${id}/tags`, { method: 'PATCH', body });

export const updateOrder = (id: string, body: OrderAddressPatchInput | Record<string, unknown>) =>
  api<OrderDetail>(`/admin/orders/${id}`, { method: 'PATCH', body });

export const assignOrder = (id: string, agentId: string | null) =>
  api<OrderDetail>(`/admin/orders/${id}/assign`, { method: 'POST', body: { agentId } });

export const listWilayas = () =>
  api<Array<{ code: number; name: Record<string, string> }>>('/shipping/wilayas');

export const listCommunes = (wilayaCode: number) =>
  api<Array<{ id: string; name: Record<string, string> }>>(
    `/shipping/wilayas/${wilayaCode}/communes`,
  );
