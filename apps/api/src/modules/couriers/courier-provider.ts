import type { DeliveryFailureReason, ShipmentStatus } from '@jecks/db';

/**
 * Courier adapters — PRD F-AD-61.
 *
 * Every Algerian courier exposes a different API and none of them share a vocabulary,
 * so the platform speaks its own and each adapter translates. Nothing above this file
 * knows what a "Yalidine parcel" is.
 *
 * The default adapter is `manual`, and it is a working implementation, not a stub: a
 * shop that hands parcels over at a counter and types the tracking number back in is
 * running the same code path as a shop with an API key.
 */

export interface CourierParcel {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  /** Second number to try. Most failed deliveries in Algeria are an unanswered phone. */
  altPhone: string | null;
  address: string | null;
  wilayaCode: number;
  wilayaName: string;
  communeName: string | null;
  /** Set for a stop-desk parcel; the courier's own point id when we know it. */
  pickupPointCode: string | null;
  isStopDesk: boolean;
  /** Cash to collect at the door, in centimes. Zero when already paid. */
  codAmountMinor: bigint;
  weightGrams: number;
  itemCount: number;
  /** What is in the parcel, for the courier's manifest. */
  contents: string;
  note: string | null;
}

export interface CourierShipmentResult {
  /** The courier's own tracking number. Null when they allocate it later. */
  trackingNumber: string | null;
  trackingUrl: string | null;
  /** What the courier says this parcel will cost us, when they say. */
  costMinor: bigint | null;
  /** A label the adapter already has; otherwise `label()` fetches it. */
  labelUrl: string | null;
  status: ShipmentStatus;
  raw: unknown;
}

export interface CourierTrackingUpdate {
  trackingNumber: string;
  status: ShipmentStatus;
  /** The courier's own wording, kept because our mapping is necessarily lossy. */
  rawStatus: string;
  message: string | null;
  failureReason: DeliveryFailureReason | null;
  occurredAt: Date;
  /** Cash the courier reports collecting, when the API says. */
  codCollectedMinor: bigint | null;
}

export interface CourierLabel {
  /** PDF bytes, ready to store and print. */
  content: Buffer;
  contentType: string;
  filename: string;
}

/**
 * What a courier can do, in the platform's own terms.
 *
 * `parseWebhook` and `track` overlap on purpose: couriers that push send webhooks, and
 * the rest are polled by the `courier.sync` job. Both produce the same update, so the
 * code that applies one never has to know which door it came through.
 */
export interface CourierProvider {
  readonly key: string;
  readonly label: string;
  /** True when the courier posts updates to us rather than waiting to be asked. */
  readonly supportsWebhook: boolean;
  readonly supportsLabel: boolean;
  readonly supportsCancel: boolean;

  /** Credential keys that must all be present before the adapter can be used. */
  readonly requiredCredentials: readonly string[];

  createShipment(parcel: CourierParcel, credentials: CourierCredentials): Promise<CourierShipmentResult>;

  track(trackingNumbers: string[], credentials: CourierCredentials): Promise<CourierTrackingUpdate[]>;

  /** Named to leave `label` free for the courier's display name. */
  fetchLabel(trackingNumber: string, credentials: CourierCredentials): Promise<CourierLabel>;

  cancel(trackingNumber: string, credentials: CourierCredentials): Promise<void>;

  /**
   * Verifies and maps an inbound webhook.
   *
   * Throws when the signature does not match. A caller must never apply an update it
   * could not verify: a forged "delivered" turns an unpaid order into a paid one.
   */
  parseWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    credentials: CourierCredentials,
  ): Promise<CourierTrackingUpdate[]>;
}

export type CourierCredentials = Record<string, string>;

/** Injectable so an adapter can be driven by a stub in tests. */
export type CourierHttpClient = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> }>;

export class CourierConfigurationError extends Error {
  readonly code = 'COURIER_NOT_READY';
  constructor(provider: string, missing: string[] = []) {
    super(
      missing.length > 0
        ? `The ${provider} courier is missing: ${missing.join(', ')}`
        : `The ${provider} courier is not configured`,
    );
    this.name = 'CourierConfigurationError';
  }
}

export class CourierRequestError extends Error {
  readonly code = 'COURIER_REJECTED';
  constructor(
    provider: string,
    readonly status: number,
    detail: string,
  ) {
    super(`${provider} refused the request (${status}): ${detail}`);
    this.name = 'CourierRequestError';
  }
}

export class CourierUnsupportedError extends Error {
  readonly code = 'COURIER_UNSUPPORTED';
  constructor(provider: string, operation: string) {
    super(`${provider} does not support ${operation}`);
    this.name = 'CourierUnsupportedError';
  }
}

export class CourierWebhookError extends Error {
  readonly code = 'WEBHOOK_SIGNATURE';
  constructor(message = 'The webhook signature does not match') {
    super(message);
    this.name = 'CourierWebhookError';
  }
}

/** Throws unless every required credential has a non-empty value. */
export function requireCredentials(
  provider: string,
  credentials: CourierCredentials,
  required: readonly string[],
): void {
  const missing = required.filter((key) => !credentials[key]?.trim());
  if (missing.length > 0) throw new CourierConfigurationError(provider, missing);
}

/**
 * Reads a JSON body, or throws with the courier's own words.
 *
 * The message matters: "Yalidine refused the request (422): to_wilaya_name invalid" is
 * something an operator can act on, and a bare 422 is not.
 */
export async function readJson<T>(
  provider: string,
  response: { ok: boolean; status: number; text: () => Promise<string> },
): Promise<T> {
  const body = await response.text();
  if (!response.ok) throw new CourierRequestError(provider, response.status, body.slice(0, 400));
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new CourierRequestError(provider, response.status, `Unreadable response: ${body.slice(0, 200)}`);
  }
}
