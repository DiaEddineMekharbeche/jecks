import type {
  CashDaySummary,
  CashReconcileInput,
  CourierDto,
  CourierInput,
  CreateShipmentInput,
  DeliveryAnalytics,
  DeliveryRunDto,
  DeliveryRunInput,
  DriverDto,
  DriverInput,
  RateMatrixRow,
  RunAssignInput,
  RunReorderInput,
  SettlementDto,
  SettlementGenerateInput,
  SettlementPayInput,
  SettlementStatusValue,
  ShipmentDetail,
  ShippingRateBulkInput,
  ShippingRateDto,
  ShippingRateInput,
  ShippingZoneDto,
  ShippingZoneInput,
  StopUpdateInput,
  TrackingImportInput,
  VehicleDto,
  VehicleInput,
} from '@jecks/shared';
import { api, download } from '@/lib/api';

/** Every call the delivery screens make — PRD F-AD-60 to F-AD-65. */

// --- zones and rates --------------------------------------------------------

export const listZones = () => api<ShippingZoneDto[]>('/admin/shipping/zones');

export const createZone = (body: ShippingZoneInput | Record<string, unknown>) =>
  api<ShippingZoneDto>('/admin/shipping/zones', { method: 'POST', body });

export const updateZone = (id: string, body: ShippingZoneInput | Record<string, unknown>) =>
  api<ShippingZoneDto>(`/admin/shipping/zones/${id}`, { method: 'PATCH', body });

export const deleteZone = (id: string) =>
  api<void>(`/admin/shipping/zones/${id}`, { method: 'DELETE' });

export const listRates = (query?: { zoneId?: string; courierId?: string }) =>
  api<ShippingRateDto[]>('/admin/shipping/rates', { query });

export const rateMatrix = (courierId?: string) =>
  api<RateMatrixRow[]>('/admin/shipping/rates/matrix', { query: courierId ? { courierId } : {} });

export const createRate = (body: ShippingRateInput | Record<string, unknown>) =>
  api<ShippingRateDto>('/admin/shipping/rates', { method: 'POST', body });

export const updateRate = (id: string, body: ShippingRateInput | Record<string, unknown>) =>
  api<ShippingRateDto>(`/admin/shipping/rates/${id}`, { method: 'PATCH', body });

export const deleteRate = (id: string) =>
  api<void>(`/admin/shipping/rates/${id}`, { method: 'DELETE' });

export const bulkRates = (body: ShippingRateBulkInput | Record<string, unknown>) =>
  api<{ written: number }>('/admin/shipping/rates/bulk', { method: 'POST', body });

// --- couriers ---------------------------------------------------------------

export const listCouriers = () => api<CourierDto[]>('/admin/couriers');

export const getCourier = (id: string) => api<CourierDto>(`/admin/couriers/${id}`);

export const courierProviders = () =>
  api<Record<string, Array<{ key: string; label: string; secret: boolean; hint?: string }>>>(
    '/admin/couriers/providers',
  );

export const createCourier = (body: CourierInput | Record<string, unknown>) =>
  api<CourierDto>('/admin/couriers', { method: 'POST', body });

export const updateCourier = (id: string, body: CourierInput | Record<string, unknown>) =>
  api<CourierDto>(`/admin/couriers/${id}`, { method: 'PATCH', body });

export const saveCourierCredentials = (id: string, values: Record<string, string>) =>
  api<CourierDto>(`/admin/couriers/${id}/credentials`, { method: 'POST', body: { values } });

export const testCourier = (id: string) =>
  api<{ ok: boolean; message: string }>(`/admin/couriers/${id}/test`, { method: 'POST' });

export const deleteCourier = (id: string) =>
  api<void>(`/admin/couriers/${id}`, { method: 'DELETE' });

// --- shipments --------------------------------------------------------------

export const getShipment = (id: string) => api<ShipmentDetail>(`/admin/shipments/${id}`);

export const shipmentCounts = () => api<Record<string, number>>('/admin/shipments/counts');

export const createShipments = (body: CreateShipmentInput | Record<string, unknown>) =>
  api<{ created: string[]; failed: Array<{ orderId: string; message: string }> }>(
    '/admin/shipments',
    { method: 'POST', body },
  );

export const updateShipment = (id: string, body: Record<string, unknown>) =>
  api<ShipmentDetail>(`/admin/shipments/${id}`, { method: 'PATCH', body });

export const cancelShipment = (id: string) =>
  api<ShipmentDetail>(`/admin/shipments/${id}/cancel`, { method: 'POST' });

export const importTracking = (body: TrackingImportInput | Record<string, unknown>) =>
  api<{ matched: number; updated: number; unmatched: string[] }>(
    '/admin/shipments/import-tracking',
    { method: 'POST', body },
  );

/** Streams the label sheet straight to the printer dialog. */
export const printLabels = (shipmentIds: string[]) =>
  download('/admin/shipments/labels', { method: 'POST', body: { shipmentIds } });

// --- fleet ------------------------------------------------------------------

export const listVehicles = () => api<VehicleDto[]>('/admin/vehicles');

export const createVehicle = (body: VehicleInput | Record<string, unknown>) =>
  api<VehicleDto>('/admin/vehicles', { method: 'POST', body });

export const updateVehicle = (id: string, body: VehicleInput | Record<string, unknown>) =>
  api<VehicleDto>(`/admin/vehicles/${id}`, { method: 'PATCH', body });

export const deleteVehicle = (id: string) =>
  api<void>(`/admin/vehicles/${id}`, { method: 'DELETE' });

export const listDrivers = () => api<DriverDto[]>('/admin/drivers');

export const createDriver = (body: DriverInput | Record<string, unknown>) =>
  api<DriverDto>('/admin/drivers', { method: 'POST', body });

export const updateDriver = (id: string, body: DriverInput | Record<string, unknown>) =>
  api<DriverDto>(`/admin/drivers/${id}`, { method: 'PATCH', body });

export const deleteDriver = (id: string) =>
  api<void>(`/admin/drivers/${id}`, { method: 'DELETE' });

// --- runs -------------------------------------------------------------------

export interface AssignableOrder {
  id: string;
  number: string;
  customerName: string;
  customerPhone: string;
  address: string | null;
  communeName: string | null;
  wilayaCode: number;
  wilayaName: string;
  itemCount: number;
  total: string;
  paidTotal: string;
  createdAt: string;
}

export const listRuns = (query?: { date?: string; driverId?: string; status?: string }) =>
  api<DeliveryRunDto[]>('/admin/delivery-runs', { query });

export const getRun = (id: string) => api<DeliveryRunDto>(`/admin/delivery-runs/${id}`);

export const assignableOrders = (query?: { date?: string; wilayaCode?: number }) =>
  api<AssignableOrder[]>('/admin/delivery-runs/assignable', { query });

export const createRun = (body: DeliveryRunInput | Record<string, unknown>) =>
  api<DeliveryRunDto>('/admin/delivery-runs', { method: 'POST', body });

export const updateRun = (id: string, body: DeliveryRunInput | Record<string, unknown>) =>
  api<DeliveryRunDto>(`/admin/delivery-runs/${id}`, { method: 'PATCH', body });

export const assignOrders = (id: string, body: RunAssignInput | Record<string, unknown>) =>
  api<DeliveryRunDto>(`/admin/delivery-runs/${id}/orders`, { method: 'POST', body });

export const unassignStop = (id: string, stopId: string) =>
  api<DeliveryRunDto>(`/admin/delivery-runs/${id}/stops/${stopId}`, { method: 'DELETE' });

export const reorderStops = (id: string, body: RunReorderInput | Record<string, unknown>) =>
  api<DeliveryRunDto>(`/admin/delivery-runs/${id}/reorder`, { method: 'POST', body });

export const optimiseRun = (id: string) =>
  api<DeliveryRunDto>(`/admin/delivery-runs/${id}/optimise`, { method: 'POST' });

export const startRun = (id: string) =>
  api<DeliveryRunDto>(`/admin/delivery-runs/${id}/start`, { method: 'POST' });

export const completeRun = (id: string) =>
  api<DeliveryRunDto>(`/admin/delivery-runs/${id}/complete`, { method: 'POST' });

export const cancelRun = (id: string) =>
  api<DeliveryRunDto>(`/admin/delivery-runs/${id}/cancel`, { method: 'POST' });

export const updateStop = (
  id: string,
  stopId: string,
  body: StopUpdateInput | Record<string, unknown>,
) => api<DeliveryRunDto>(`/admin/delivery-runs/${id}/stops/${stopId}`, { method: 'PATCH', body });

export const printManifest = (id: string) => download(`/admin/delivery-runs/${id}/manifest`);

// --- cash and settlements ---------------------------------------------------

export const dailyCash = (date: string) =>
  api<CashDaySummary>('/admin/cash/daily', { query: { date } });

export interface OutstandingCollection {
  id: string;
  orderNumber: string;
  customerName: string;
  amountMinor: string;
  collectedAt: string;
  note: string | null;
}

export const outstandingCash = (kind: 'driver' | 'courier', id: string) =>
  api<OutstandingCollection[]>('/admin/cash/outstanding', { query: { kind, id } });

export const reconcileCash = (body: CashReconcileInput | Record<string, unknown>) =>
  api<{ reconciled: number; amountMinor: string }>('/admin/cash/reconcile', {
    method: 'POST',
    body,
  });

export const listSettlements = (query?: { courierId?: string; status?: string }) =>
  api<SettlementDto[]>('/admin/settlements', { query });

export const getSettlement = (id: string) => api<SettlementDto>(`/admin/settlements/${id}`);

export const generateSettlement = (body: SettlementGenerateInput | Record<string, unknown>) =>
  api<SettlementDto>('/admin/settlements', { method: 'POST', body });

export const setSettlementStatus = (id: string, status: SettlementStatusValue) =>
  api<SettlementDto>(`/admin/settlements/${id}/status`, { method: 'POST', body: { status } });

export const paySettlement = (id: string, body: SettlementPayInput | Record<string, unknown>) =>
  api<SettlementDto>(`/admin/settlements/${id}/pay`, { method: 'POST', body });

export const deleteSettlement = (id: string) =>
  api<void>(`/admin/settlements/${id}`, { method: 'DELETE' });

// --- analytics --------------------------------------------------------------

export const deliveryAnalytics = (query: { from: string; to: string }) =>
  api<DeliveryAnalytics>('/admin/delivery/analytics', { query });

// --- the driver's own view --------------------------------------------------

export const myRun = () => api<DeliveryRunDto | null>('/driver/run');

export const myRunById = (id: string) => api<DeliveryRunDto>(`/driver/runs/${id}`);

export const reportStop = (
  runId: string,
  stopId: string,
  body: StopUpdateInput | Record<string, unknown>,
) => api<DeliveryRunDto>(`/driver/runs/${runId}/stops/${stopId}`, { method: 'PATCH', body });
