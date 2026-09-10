import { DeliveryFailureReason, DeliveryType, ShipmentStatus } from '@jecks/shared';

/** The vocabulary the delivery screens render — PRD F-AD-60 to F-AD-65. */

export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  [ShipmentStatus.CREATED]: 'Créée',
  [ShipmentStatus.PICKED_UP]: 'Ramassée',
  [ShipmentStatus.IN_TRANSIT]: 'En transit',
  [ShipmentStatus.OUT_FOR_DELIVERY]: 'En livraison',
  [ShipmentStatus.DELIVERED]: 'Livrée',
  [ShipmentStatus.FAILED]: 'Échec',
  [ShipmentStatus.RETURNED]: 'Retournée',
  [ShipmentStatus.CANCELLED]: 'Annulée',
};

export const SHIPMENT_STATUS_TONES: Record<
  string,
  'neutral' | 'info' | 'brass' | 'success' | 'warning' | 'danger'
> = {
  [ShipmentStatus.CREATED]: 'neutral',
  [ShipmentStatus.PICKED_UP]: 'info',
  [ShipmentStatus.IN_TRANSIT]: 'info',
  [ShipmentStatus.OUT_FOR_DELIVERY]: 'brass',
  [ShipmentStatus.DELIVERED]: 'success',
  [ShipmentStatus.FAILED]: 'danger',
  [ShipmentStatus.RETURNED]: 'warning',
  [ShipmentStatus.CANCELLED]: 'neutral',
};

export const DELIVERY_TYPE_LABELS: Record<string, string> = {
  [DeliveryType.HOME]: 'À domicile',
  [DeliveryType.STOP_DESK]: 'Stop desk',
};

export const FAILURE_LABELS: Record<string, string> = {
  [DeliveryFailureReason.NO_ANSWER]: 'Injoignable',
  [DeliveryFailureReason.REFUSED]: 'Colis refusé',
  [DeliveryFailureReason.WRONG_ADDRESS]: 'Adresse erronée',
  [DeliveryFailureReason.CUSTOMER_ABSENT]: 'Client absent',
  [DeliveryFailureReason.RESCHEDULED]: 'Reporté',
  [DeliveryFailureReason.DAMAGED]: 'Colis endommagé',
  [DeliveryFailureReason.OTHER]: 'Autre',
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Planifiée',
  IN_PROGRESS: 'En cours',
  COMPLETED: 'Terminée',
  CANCELLED: 'Annulée',
};

export const RUN_STATUS_TONES: Record<string, 'neutral' | 'info' | 'brass' | 'success'> = {
  PLANNED: 'info',
  IN_PROGRESS: 'brass',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export const STOP_STATUS_LABELS: Record<string, string> = {
  PENDING: 'À livrer',
  ARRIVED: 'Sur place',
  DELIVERED: 'Livré',
  FAILED: 'Échec',
  RESCHEDULED: 'Reporté',
};

export const STOP_STATUS_TONES: Record<
  string,
  'neutral' | 'info' | 'brass' | 'success' | 'warning' | 'danger'
> = {
  PENDING: 'neutral',
  ARRIVED: 'brass',
  DELIVERED: 'success',
  FAILED: 'danger',
  RESCHEDULED: 'warning',
};

export const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Ouvert',
  SENT: 'Envoyé',
  PAID: 'Soldé',
  DISPUTED: 'En litige',
};

export const SETTLEMENT_STATUS_TONES: Record<
  string,
  'neutral' | 'info' | 'success' | 'warning' | 'danger'
> = {
  OPEN: 'info',
  SENT: 'warning',
  PAID: 'success',
  DISPUTED: 'danger',
};

export const VEHICLE_KIND_LABELS: Record<string, string> = {
  van: 'Fourgonnette',
  truck: 'Camion',
  motorbike: 'Moto',
  car: 'Voiture',
};

export const COURIER_PROVIDER_LABELS: Record<string, string> = {
  manual: 'Remise en main propre',
  yalidine: 'Yalidine',
  zrexpress: 'ZR Express',
  maystro: 'Maystro Delivery',
  ems: 'EMS Champion Post',
};

/**
 * Deep links a driver actually uses at the wheel.
 *
 * Waze first because it is what Algerian drivers have; Google Maps as the fallback for
 * a phone that does not. Both take coordinates when we have them and the written
 * address when we do not.
 */
export function wazeLink(
  latitude: number | null,
  longitude: number | null,
  address: string | null,
): string {
  if (latitude !== null && longitude !== null) {
    return `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`;
  }
  return `https://waze.com/ul?q=${encodeURIComponent(address ?? '')}&navigate=yes`;
}

export function mapsLink(
  latitude: number | null,
  longitude: number | null,
  address: string | null,
): string {
  const destination =
    latitude !== null && longitude !== null ? `${latitude},${longitude}` : (address ?? '');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
