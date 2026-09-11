import { Injectable, Optional } from '@nestjs/common';
import { ShipmentStatus } from '@jecks/db';
import {
  CourierRequestError,
  CourierUnsupportedError,
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
import { mapReason } from './yalidine.courier.js';

/**
 * EMS Champion Post — the national post's express service (PRD F-AD-61).
 *
 * Slower than the private couriers and cheaper, and the only one that reaches every
 * commune in the deep south, which is why a shop keeps it alongside the others.
 *
 * It speaks the universal postal vocabulary rather than a French one: their events come
 * as EMS event codes (EMA, EMC, EDD, EMD…), which are defined by the UPU and therefore
 * the one mapping in this folder that will not change when a company redesigns its app.
 */

const API_BASE = 'https://ems.poste.dz/api/v1';

interface EmsCreateResponse {
  success?: boolean;
  message?: string;
  data?: { barcode?: string; item_id?: string; fee?: number };
}

interface EmsTrackEvent {
  barcode: string;
  event_code: string;
  event_name?: string;
  event_date: string;
  office?: string;
  comment?: string | null;
}

interface EmsTrackResponse {
  data?: EmsTrackEvent[];
}

/**
 * UPU EMS event codes.
 *
 * EMA posting, EMB in transit at origin, EMC despatched, EMD arrival at destination,
 * EMH held, EMI attempted delivery, EMJ retained, EDA out for delivery, EDB delivered,
 * EDC returned. Anything unknown is treated as movement, never as an outcome: inventing
 * a delivery from an unrecognised code is how a shop marks a parcel paid that is still
 * on a shelf in Ouargla.
 */
const STATUS_BY_EVENT: Record<string, ShipmentStatus> = {
  EMA: ShipmentStatus.PICKED_UP,
  EMB: ShipmentStatus.IN_TRANSIT,
  EMC: ShipmentStatus.IN_TRANSIT,
  EMD: ShipmentStatus.IN_TRANSIT,
  EME: ShipmentStatus.IN_TRANSIT,
  EMF: ShipmentStatus.IN_TRANSIT,
  EMG: ShipmentStatus.IN_TRANSIT,
  EMH: ShipmentStatus.IN_TRANSIT,
  EDA: ShipmentStatus.OUT_FOR_DELIVERY,
  EMI: ShipmentStatus.OUT_FOR_DELIVERY,
  EMJ: ShipmentStatus.OUT_FOR_DELIVERY,
  EDB: ShipmentStatus.DELIVERED,
  EDD: ShipmentStatus.DELIVERED,
  EDC: ShipmentStatus.RETURNED,
  EDX: ShipmentStatus.FAILED,
};

@Injectable()
export class EmsCourier implements CourierProvider {
  readonly key = 'ems';
  readonly label = 'EMS Champion Post';
  readonly supportsWebhook = false;
  readonly supportsLabel = false;
  readonly supportsCancel = false;
  readonly requiredCredentials = ['accountNumber', 'password'] as const;

  constructor(@Optional() private readonly http: CourierHttpClient = (url, init) => fetch(url, init)) {}

  async createShipment(
    parcel: CourierParcel,
    credentials: CourierCredentials,
  ): Promise<CourierShipmentResult> {
    requireCredentials(this.key, credentials, this.requiredCredentials);

    const body = {
      account: credentials.accountNumber,
      reference: parcel.orderNumber,
      recipient: {
        name: parcel.customerName,
        phone: parcel.customerPhone,
        alt_phone: parcel.altPhone ?? undefined,
        address: parcel.address ?? parcel.communeName ?? parcel.wilayaName,
        commune: parcel.communeName ?? undefined,
        wilaya_code: parcel.wilayaCode,
      },
      parcel: {
        weight_grams: Math.max(100, parcel.weightGrams),
        pieces: parcel.itemCount,
        description: parcel.contents,
        // Whole dinars, like every Algerian carrier API.
        cod_amount: Number(parcel.codAmountMinor / 100n),
      },
      service: parcel.isStopDesk ? 'BUREAU' : 'DOMICILE',
    };

    const response = await this.http(`${API_BASE}/shipments`, {
      method: 'POST',
      headers: this.headers(credentials),
      body: JSON.stringify(body),
    });

    const parsed = await readJson<EmsCreateResponse>(this.key, response);
    const barcode = parsed.data?.barcode ?? parsed.data?.item_id;

    if (parsed.success === false || !barcode) {
      throw new CourierRequestError(this.key, response.status, parsed.message ?? 'Shipment refused');
    }

    return {
      trackingNumber: barcode,
      trackingUrl: `https://ems.poste.dz/suivi/${encodeURIComponent(barcode)}`,
      // EMS quotes the fee up front, which is more than the private couriers do.
      costMinor: parsed.data?.fee === undefined ? null : BigInt(Math.round(parsed.data.fee * 100)),
      labelUrl: null,
      status: ShipmentStatus.CREATED,
      raw: parsed,
    };
  }

  async track(
    trackingNumbers: string[],
    credentials: CourierCredentials,
  ): Promise<CourierTrackingUpdate[]> {
    requireCredentials(this.key, credentials, this.requiredCredentials);
    if (trackingNumbers.length === 0) return [];

    const query = new URLSearchParams({ barcodes: trackingNumbers.join(',') });
    const response = await this.http(`${API_BASE}/tracking?${query.toString()}`, {
      method: 'GET',
      headers: this.headers(credentials),
    });

    const parsed = await readJson<EmsTrackResponse>(this.key, response);
    return (parsed.data ?? []).map((event) => this.toUpdate(event));
  }

  async fetchLabel(): Promise<CourierLabel> {
    throw new CourierUnsupportedError(this.key, 'label fetching');
  }

  async cancel(): Promise<void> {
    throw new CourierUnsupportedError(this.key, 'cancellation');
  }

  async parseWebhook(): Promise<CourierTrackingUpdate[]> {
    throw new CourierWebhookError('EMS does not send webhooks; it is polled');
  }

  toUpdate(event: EmsTrackEvent): CourierTrackingUpdate {
    const code = (event.event_code ?? '').trim().toUpperCase();
    const status = STATUS_BY_EVENT[code] ?? ShipmentStatus.IN_TRANSIT;

    return {
      trackingNumber: event.barcode,
      status,
      rawStatus: code || 'inconnu',
      message: event.comment ?? event.event_name ?? event.office ?? null,
      failureReason:
        status === ShipmentStatus.FAILED || status === ShipmentStatus.RETURNED
          ? mapReason(event.comment ?? event.event_name ?? '')
          : null,
      occurredAt: event.event_date ? new Date(event.event_date) : new Date(),
      codCollectedMinor: null,
    };
  }

  private headers(credentials: CourierCredentials): Record<string, string> {
    const basic = Buffer.from(
      `${credentials.accountNumber ?? ''}:${credentials.password ?? ''}`,
      'utf8',
    ).toString('base64');

    return { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' };
  }
}
