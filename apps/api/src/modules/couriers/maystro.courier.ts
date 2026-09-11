import { Injectable, Optional } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DeliveryFailureReason, ShipmentStatus } from '@jecks/db';
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

/**
 * Maystro Delivery — PRD F-AD-61.
 *
 * The only one of the four that pushes. Their webhook posts a status change as it
 * happens, which means near-real-time delivery confirmations and, because the same
 * message marks an order paid, the one adapter where signature verification is not
 * optional.
 *
 * Their API is JSON over a bearer token, addresses by wilaya code, and speaks in whole
 * dinars like the rest.
 */

const API_BASE = 'https://backend.maystro-delivery.com/api/base/stores/orders';

interface MaystroOrderResponse {
  id?: number;
  display_id?: string;
  tracking_number?: string;
  status?: number;
  detail?: string;
}

interface MaystroWebhookBody {
  tracking_number?: string;
  display_id?: string;
  status?: number;
  status_name?: string;
  reason?: string | null;
  updated_at?: string;
  collected_amount?: number | string | null;
}

/**
 * Their numeric status codes.
 *
 * Numbers rather than words, so a typo here is invisible until a parcel is stuck. The
 * ones that matter are 41 delivered, 50 returned and 11 cancelled; everything between
 * 4 and 31 is some flavour of moving.
 */
const STATUS_BY_CODE: Record<number, ShipmentStatus> = {
  4: ShipmentStatus.CREATED,
  5: ShipmentStatus.CREATED,
  6: ShipmentStatus.PICKED_UP,
  8: ShipmentStatus.IN_TRANSIT,
  9: ShipmentStatus.IN_TRANSIT,
  10: ShipmentStatus.IN_TRANSIT,
  11: ShipmentStatus.CANCELLED,
  15: ShipmentStatus.IN_TRANSIT,
  22: ShipmentStatus.OUT_FOR_DELIVERY,
  31: ShipmentStatus.OUT_FOR_DELIVERY,
  32: ShipmentStatus.FAILED,
  41: ShipmentStatus.DELIVERED,
  42: ShipmentStatus.DELIVERED,
  50: ShipmentStatus.RETURNED,
  51: ShipmentStatus.RETURNED,
};

@Injectable()
export class MaystroCourier implements CourierProvider {
  readonly key = 'maystro';
  readonly label = 'Maystro Delivery';
  readonly supportsWebhook = true;
  readonly supportsLabel = false;
  readonly supportsCancel = true;
  readonly requiredCredentials = ['apiKey'] as const;

  constructor(@Optional() private readonly http: CourierHttpClient = (url, init) => fetch(url, init)) {}

  async createShipment(
    parcel: CourierParcel,
    credentials: CourierCredentials,
  ): Promise<CourierShipmentResult> {
    requireCredentials(this.key, credentials, this.requiredCredentials);

    const body = {
      destination_text: parcel.address ?? parcel.communeName ?? parcel.wilayaName,
      customer_name: parcel.customerName,
      customer_phone: parcel.customerPhone,
      product_price: Number(parcel.codAmountMinor / 100n),
      wilaya: parcel.wilayaCode,
      commune: parcel.communeName ?? undefined,
      express: false,
      note_to_driver: parcel.note ?? undefined,
      external_order_id: parcel.orderNumber,
      products: [{ product_id: parcel.orderNumber, quantity: parcel.itemCount, logistical_description: parcel.contents }],
      ...(parcel.isStopDesk
        ? { delivery_type: 1, stopdesk_id: parcel.pickupPointCode ? Number(parcel.pickupPointCode) : undefined }
        : { delivery_type: 0 }),
    };

    const response = await this.http(`${API_BASE}/`, {
      method: 'POST',
      headers: this.headers(credentials),
      body: JSON.stringify(body),
    });

    const parsed = await readJson<MaystroOrderResponse>(this.key, response);
    const tracking = parsed.tracking_number ?? parsed.display_id ?? null;

    if (!tracking) {
      throw new CourierRequestError(this.key, response.status, parsed.detail ?? 'No tracking number returned');
    }

    return {
      trackingNumber: tracking,
      trackingUrl: `https://maystro-delivery.com/tracking/${encodeURIComponent(tracking)}`,
      costMinor: null,
      labelUrl: null,
      status: parsed.status ? (STATUS_BY_CODE[parsed.status] ?? ShipmentStatus.CREATED) : ShipmentStatus.CREATED,
      raw: parsed,
    };
  }

  async track(
    trackingNumbers: string[],
    credentials: CourierCredentials,
  ): Promise<CourierTrackingUpdate[]> {
    requireCredentials(this.key, credentials, this.requiredCredentials);
    if (trackingNumbers.length === 0) return [];

    const updates: CourierTrackingUpdate[] = [];
    for (const tracking of trackingNumbers) {
      const response = await this.http(`${API_BASE}/?tracking_number=${encodeURIComponent(tracking)}`, {
        method: 'GET',
        headers: this.headers(credentials),
      });
      const parsed = await readJson<{ results?: MaystroWebhookBody[] }>(this.key, response);
      for (const entry of parsed.results ?? []) updates.push(this.toUpdate(entry, tracking));
    }
    return updates;
  }

  async fetchLabel(): Promise<CourierLabel> {
    throw new CourierUnsupportedError(this.key, 'label fetching');
  }

  async cancel(trackingNumber: string, credentials: CourierCredentials): Promise<void> {
    requireCredentials(this.key, credentials, this.requiredCredentials);

    const response = await this.http(`${API_BASE}/${encodeURIComponent(trackingNumber)}/`, {
      method: 'DELETE',
      headers: this.headers(credentials),
    });

    if (!response.ok) {
      throw new CourierRequestError(this.key, response.status, await response.text());
    }
  }

  /**
   * Verifies the signature before reading a single field.
   *
   * This message can mark an order delivered and paid. Parsing first and checking after
   * is how a forged body ends up in the audit log as a real delivery, so the HMAC is
   * computed over the raw body exactly as received.
   */
  async parseWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    credentials: CourierCredentials,
  ): Promise<CourierTrackingUpdate[]> {
    const secret = credentials.webhookSecret ?? credentials.apiKey;
    if (!secret) throw new CourierWebhookError('No webhook secret is configured');

    const provided = headerValue(headers, 'x-maystro-signature') ?? headerValue(headers, 'x-signature');
    if (!provided) throw new CourierWebhookError('The webhook carried no signature');

    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    if (!constantTimeEquals(provided.trim().replace(/^sha256=/, ''), expected)) {
      throw new CourierWebhookError();
    }

    const body = JSON.parse(rawBody) as MaystroWebhookBody | MaystroWebhookBody[];
    const entries = Array.isArray(body) ? body : [body];

    return entries
      .filter((entry) => Boolean(entry.tracking_number ?? entry.display_id))
      .map((entry) => this.toUpdate(entry, entry.tracking_number ?? entry.display_id!));
  }

  toUpdate(entry: MaystroWebhookBody, fallbackTracking: string): CourierTrackingUpdate {
    const status = entry.status !== undefined ? STATUS_BY_CODE[entry.status] : undefined;
    const resolved = status ?? ShipmentStatus.IN_TRANSIT;
    const collected = entry.collected_amount;

    return {
      trackingNumber: entry.tracking_number ?? entry.display_id ?? fallbackTracking,
      status: resolved,
      rawStatus: entry.status_name ?? (entry.status !== undefined ? String(entry.status) : 'inconnu'),
      message: entry.reason ?? null,
      failureReason:
        resolved === ShipmentStatus.FAILED || resolved === ShipmentStatus.RETURNED
          ? failureFromCode(entry.status, entry.reason ?? '')
          : null,
      occurredAt: entry.updated_at ? new Date(entry.updated_at) : new Date(),
      codCollectedMinor:
        collected === undefined || collected === null || collected === ''
          ? null
          : BigInt(Math.round(Number(collected) * 100)),
    };
  }

  private headers(credentials: CourierCredentials): Record<string, string> {
    return {
      Authorization: `Token ${credentials.apiKey ?? ''}`,
      'Content-Type': 'application/json',
    };
  }
}

function failureFromCode(code: number | undefined, reason: string): DeliveryFailureReason {
  if (/injoignable|répond/i.test(reason)) return DeliveryFailureReason.NO_ANSWER;
  if (/refus/i.test(reason)) return DeliveryFailureReason.REFUSED;
  if (/adresse/i.test(reason)) return DeliveryFailureReason.WRONG_ADDRESS;
  if (/absent/i.test(reason)) return DeliveryFailureReason.CUSTOMER_ABSENT;
  if (code === 50 || code === 51) return DeliveryFailureReason.REFUSED;
  return DeliveryFailureReason.OTHER;
}

/**
 * Reads a header without caring how it was capitalised.
 *
 * Express lowercases what it parses, but this also runs against raw objects in tests and
 * against whatever a proxy passes through, and HTTP header names are case-insensitive by
 * definition. Trying three fixed spellings would miss `X-Signature`.
 */
export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }
  return null;
}

/** Compares without leaking, by length or by timing, how close a guess was. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
