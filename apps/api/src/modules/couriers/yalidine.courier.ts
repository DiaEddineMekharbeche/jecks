import { Injectable, Optional } from '@nestjs/common';
import { DeliveryFailureReason, ShipmentStatus } from '@jecks/db';
import {
  CourierRequestError,
  CourierWebhookError,
  readJson,
  requireCredentials,
  type CourierCredentials,
  type CourierHttpClient,
  type CourierLabel,
  type CourierParcel,
  type CourierProvider,
  type CourierShipmentResult,
  type CourierTrackingUpdate,
} from './courier-provider.js';

/**
 * Yalidine — the largest COD courier in Algeria (PRD F-AD-61).
 *
 * Built against their documented v1 REST API. Two of its habits shape this adapter:
 *
 * Prices are in whole dinars, not centimes. Everything inside the platform is centimes,
 * so the conversion happens here and only here.
 *
 * Parcels are addressed by wilaya *name*, not code, and the name has to match theirs
 * exactly. We send the name from our own wilaya table, which is seeded from the official
 * list, and let their 422 tell us when a spelling has drifted rather than silently
 * shipping to the wrong place.
 */

const API_BASE = 'https://api.yalidine.app/v1';

interface YalidineParcelResponse {
  [orderNumber: string]: {
    success: boolean;
    order_id?: string;
    tracking?: string;
    label?: string;
    message?: string;
    import_id?: number;
  };
}

interface YalidineHistoryEntry {
  tracking: string;
  status: string;
  date_status: string;
  reason?: string | null;
}

interface YalidineHistoryResponse {
  data: YalidineHistoryEntry[];
}

/**
 * Their status vocabulary, mapped onto ours.
 *
 * Yalidine distinguishes a dozen shades of "on its way"; we keep four. What matters is
 * that every terminal state maps exactly, because those are the ones that move money.
 */
const STATUS_MAP: Record<string, ShipmentStatus> = {
  'Pas encore expédié': ShipmentStatus.CREATED,
  'A vérifier': ShipmentStatus.CREATED,
  'En préparation': ShipmentStatus.CREATED,
  'Pas encore ramassé': ShipmentStatus.CREATED,
  'Prêt à expédier': ShipmentStatus.CREATED,
  Ramassé: ShipmentStatus.PICKED_UP,
  'Bloqué': ShipmentStatus.IN_TRANSIT,
  'Débloqué': ShipmentStatus.IN_TRANSIT,
  'Transfert': ShipmentStatus.IN_TRANSIT,
  'Expédié': ShipmentStatus.IN_TRANSIT,
  'Centre': ShipmentStatus.IN_TRANSIT,
  'En localisation': ShipmentStatus.IN_TRANSIT,
  'Vers Wilaya': ShipmentStatus.IN_TRANSIT,
  'Reçu à Wilaya': ShipmentStatus.IN_TRANSIT,
  'En attente du client': ShipmentStatus.OUT_FOR_DELIVERY,
  'Prêt pour livreur': ShipmentStatus.OUT_FOR_DELIVERY,
  'Sorti en livraison': ShipmentStatus.OUT_FOR_DELIVERY,
  'En attente': ShipmentStatus.OUT_FOR_DELIVERY,
  'En alerte': ShipmentStatus.OUT_FOR_DELIVERY,
  'Tentative échouée': ShipmentStatus.OUT_FOR_DELIVERY,
  Livré: ShipmentStatus.DELIVERED,
  'Echèc livraison': ShipmentStatus.FAILED,
  'Echec livraison': ShipmentStatus.FAILED,
  'Retour vers centre': ShipmentStatus.RETURNED,
  'Retourné au centre': ShipmentStatus.RETURNED,
  'Retour transfert': ShipmentStatus.RETURNED,
  'Retour groupé': ShipmentStatus.RETURNED,
  'Retour à retirer': ShipmentStatus.RETURNED,
  'Retour vers vendeur': ShipmentStatus.RETURNED,
  'Retourné au vendeur': ShipmentStatus.RETURNED,
  'Echange échoué': ShipmentStatus.RETURNED,
  Annulé: ShipmentStatus.CANCELLED,
};

/** Their failure wording, mapped onto the reasons our reports count. */
const REASON_MAP: Array<[RegExp, DeliveryFailureReason]> = [
  [/injoignable|ne répond|pas de réponse/i, DeliveryFailureReason.NO_ANSWER],
  [/annul|refus/i, DeliveryFailureReason.REFUSED],
  [/adresse|erron|introuvable/i, DeliveryFailureReason.WRONG_ADDRESS],
  [/absent|voyage/i, DeliveryFailureReason.CUSTOMER_ABSENT],
  [/report|reprogram/i, DeliveryFailureReason.RESCHEDULED],
  [/endommag|cass/i, DeliveryFailureReason.DAMAGED],
];

@Injectable()
export class YalidineCourier implements CourierProvider {
  readonly key = 'yalidine';
  readonly label = 'Yalidine';
  readonly supportsWebhook = false;
  readonly supportsLabel = true;
  readonly supportsCancel = true;
  readonly requiredCredentials = ['apiId', 'apiToken'] as const;

  constructor(@Optional() private readonly http: CourierHttpClient = (url, init) => fetch(url, init)) {}

  async createShipment(
    parcel: CourierParcel,
    credentials: CourierCredentials,
  ): Promise<CourierShipmentResult> {
    requireCredentials(this.key, credentials, this.requiredCredentials);

    const body = [
      {
        order_id: parcel.orderNumber,
        firstname: firstName(parcel.customerName),
        familyname: lastName(parcel.customerName),
        contact_phone: parcel.customerPhone,
        address: parcel.address ?? parcel.communeName ?? parcel.wilayaName,
        to_commune_name: parcel.communeName ?? parcel.wilayaName,
        to_wilaya_name: parcel.wilayaName,
        product_list: parcel.contents,
        // Whole dinars: their API rejects a decimal, and a centime value would ask the
        // customer for a hundred times the price.
        price: Number(parcel.codAmountMinor / 100n),
        do_insurance: false,
        declared_value: Number(parcel.codAmountMinor / 100n),
        length: 0,
        width: 0,
        height: 0,
        weight: Math.max(1, Math.round(parcel.weightGrams / 1000)),
        freeshipping: parcel.codAmountMinor === 0n,
        is_stopdesk: parcel.isStopDesk,
        stopdesk_id: parcel.pickupPointCode ? Number(parcel.pickupPointCode) : undefined,
        has_exchange: false,
        from_wilaya_name: credentials.fromWilayaName ?? undefined,
      },
    ];

    const response = await this.http(`${API_BASE}/parcels/`, {
      method: 'POST',
      headers: this.headers(credentials),
      body: JSON.stringify(body),
    });

    const parsed = await readJson<YalidineParcelResponse>(this.key, response);
    const entry = parsed[parcel.orderNumber];

    // Yalidine answers 200 with a per-parcel failure, so the status code is not enough.
    if (!entry?.success) {
      throw new CourierRequestError(this.key, response.status, entry?.message ?? 'Parcel refused');
    }

    return {
      trackingNumber: entry.tracking ?? null,
      trackingUrl: entry.tracking ? `https://yalidine.com/suivi-de-colis/?tracking=${entry.tracking}` : null,
      costMinor: null,
      labelUrl: entry.label ?? null,
      status: ShipmentStatus.CREATED,
      raw: entry,
    };
  }

  async track(
    trackingNumbers: string[],
    credentials: CourierCredentials,
  ): Promise<CourierTrackingUpdate[]> {
    requireCredentials(this.key, credentials, this.requiredCredentials);
    if (trackingNumbers.length === 0) return [];

    const query = new URLSearchParams({ tracking: trackingNumbers.join(','), page_size: '200' });
    const response = await this.http(`${API_BASE}/histories/?${query.toString()}`, {
      method: 'GET',
      headers: this.headers(credentials),
    });

    const parsed = await readJson<YalidineHistoryResponse>(this.key, response);
    return (parsed.data ?? []).map((entry) => this.toUpdate(entry));
  }

  async fetchLabel(trackingNumber: string, credentials: CourierCredentials): Promise<CourierLabel> {
    requireCredentials(this.key, credentials, this.requiredCredentials);

    const response = await this.http(`${API_BASE}/parcels/${trackingNumber}/label`, {
      method: 'GET',
      headers: this.headers(credentials),
    });

    if (!response.ok) {
      throw new CourierRequestError(this.key, response.status, await response.text());
    }

    const bytes = response.arrayBuffer
      ? Buffer.from(await response.arrayBuffer())
      : Buffer.from(await response.text(), 'binary');

    return { content: bytes, contentType: 'application/pdf', filename: `${trackingNumber}.pdf` };
  }

  async cancel(trackingNumber: string, credentials: CourierCredentials): Promise<void> {
    requireCredentials(this.key, credentials, this.requiredCredentials);

    const response = await this.http(`${API_BASE}/parcels/${trackingNumber}`, {
      method: 'DELETE',
      headers: this.headers(credentials),
    });

    if (!response.ok) {
      throw new CourierRequestError(this.key, response.status, await response.text());
    }
  }

  /**
   * Yalidine has no webhooks, so this refuses rather than accepting an unverified body.
   *
   * A request arriving here is either misrouted or forged, and both deserve the same
   * answer.
   */
  async parseWebhook(): Promise<CourierTrackingUpdate[]> {
    throw new CourierWebhookError('Yalidine does not send webhooks; it is polled');
  }

  /** Exposed for the tests: mapping their vocabulary is the part that breaks. */
  toUpdate(entry: YalidineHistoryEntry): CourierTrackingUpdate {
    const status = STATUS_MAP[entry.status.trim()] ?? ShipmentStatus.IN_TRANSIT;
    return {
      trackingNumber: entry.tracking,
      status,
      rawStatus: entry.status,
      message: entry.reason ?? null,
      failureReason:
        status === ShipmentStatus.FAILED || status === ShipmentStatus.RETURNED
          ? mapReason(entry.reason ?? entry.status)
          : null,
      occurredAt: parseDate(entry.date_status),
      codCollectedMinor: null,
    };
  }

  private headers(credentials: CourierCredentials): Record<string, string> {
    return {
      'X-API-ID': credentials.apiId ?? '',
      'X-API-TOKEN': credentials.apiToken ?? '',
      'Content-Type': 'application/json',
    };
  }
}

export function mapReason(text: string): DeliveryFailureReason {
  for (const [pattern, reason] of REASON_MAP) {
    if (pattern.test(text)) return reason;
  }
  return DeliveryFailureReason.OTHER;
}

/**
 * Their timestamps come as "2026-09-10 14:32:07" with no zone, in Algiers time.
 *
 * Parsing that as UTC shifts every delivery an hour, which is enough to move a parcel
 * into the wrong day on a daily report.
 */
export function parseDate(value: string): Date {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return new Date();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) return new Date(trimmed);

  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) {
    const fallback = new Date(trimmed);
    return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
  }

  const [, year, month, day, hour, minute, second = '00'] = match;
  // Algeria is UTC+1 all year: no daylight saving since 1981.
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 1,
      Number(minute),
      Number(second),
    ),
  );
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0] ?? '';
}
