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
import { mapReason, parseDate } from './yalidine.courier.js';

/**
 * ZR Express — PRD F-AD-61.
 *
 * Their API authenticates with a token and a key in the headers, takes a batch of
 * parcels under a `Colis` array, and addresses by wilaya *code* rather than name, which
 * is the opposite of Yalidine and the single most common integration mistake.
 *
 * Money is whole dinars again, and the tracking number is ours: ZR echoes back the
 * `Tracking` we send, so the order number is what appears on their dashboard.
 */

const API_BASE = 'https://procolis.com/api_v1';

interface ZrAddResponse {
  Colis?: Array<{ Tracking?: string; MessageRetour?: string }>;
  message?: string;
}

interface ZrStatusResponse {
  Colis?: Array<{
    Tracking: string;
    Situation?: string;
    Commentaire?: string;
    DateH?: string;
    MontantRecu?: string | number;
  }>;
}

/** Their situations, in French, mapped onto our statuses. */
const STATUS_MAP: Record<string, ShipmentStatus> = {
  'En Attente': ShipmentStatus.CREATED,
  'Vers Wilaya': ShipmentStatus.IN_TRANSIT,
  'Reçu à Wilaya': ShipmentStatus.IN_TRANSIT,
  'En Traitement': ShipmentStatus.IN_TRANSIT,
  Ramassé: ShipmentStatus.PICKED_UP,
  Transfert: ShipmentStatus.IN_TRANSIT,
  Sorti: ShipmentStatus.OUT_FOR_DELIVERY,
  'Sorti en Livraison': ShipmentStatus.OUT_FOR_DELIVERY,
  Livré: ShipmentStatus.DELIVERED,
  'Livré Payé': ShipmentStatus.DELIVERED,
  'Encaissé': ShipmentStatus.DELIVERED,
  Reporté: ShipmentStatus.OUT_FOR_DELIVERY,
  Suspendu: ShipmentStatus.FAILED,
  'Echange': ShipmentStatus.IN_TRANSIT,
  Retour: ShipmentStatus.RETURNED,
  'Retour vers vendeur': ShipmentStatus.RETURNED,
  'Retourné': ShipmentStatus.RETURNED,
  Annulé: ShipmentStatus.CANCELLED,
};

@Injectable()
export class ZrExpressCourier implements CourierProvider {
  readonly key = 'zrexpress';
  readonly label = 'ZR Express';
  readonly supportsWebhook = false;
  readonly supportsLabel = false;
  readonly supportsCancel = false;
  readonly requiredCredentials = ['token', 'key'] as const;

  constructor(@Optional() private readonly http: CourierHttpClient = (url, init) => fetch(url, init)) {}

  async createShipment(
    parcel: CourierParcel,
    credentials: CourierCredentials,
  ): Promise<CourierShipmentResult> {
    requireCredentials(this.key, credentials, this.requiredCredentials);

    const body = {
      Colis: [
        {
          Tracking: parcel.orderNumber,
          TypeLivraison: parcel.isStopDesk ? '1' : '0',
          TypeColis: '0',
          Confrimee: '',
          Client: parcel.customerName,
          MobileA: parcel.customerPhone,
          MobileB: parcel.altPhone ?? '',
          Adresse: parcel.address ?? parcel.communeName ?? parcel.wilayaName,
          // Code, not name: their IDWilaya is the official two-digit number.
          IDWilaya: String(parcel.wilayaCode).padStart(2, '0'),
          Commune: parcel.communeName ?? parcel.wilayaName,
          Total: String(parcel.codAmountMinor / 100n),
          Note: parcel.note ?? '',
          TProduit: parcel.contents,
          id_Externe: parcel.orderId,
          Source: 'jecks',
        },
      ],
    };

    const response = await this.http(`${API_BASE}/add_colis`, {
      method: 'POST',
      headers: this.headers(credentials),
      body: JSON.stringify(body),
    });

    const parsed = await readJson<ZrAddResponse>(this.key, response);
    const entry = parsed.Colis?.[0];

    // A per-parcel message that is not "Good" is a refusal wearing a 200.
    if (entry?.MessageRetour && !/good|succ|ok/i.test(entry.MessageRetour)) {
      throw new CourierRequestError(this.key, response.status, entry.MessageRetour);
    }

    const tracking = entry?.Tracking ?? parcel.orderNumber;
    return {
      trackingNumber: tracking,
      trackingUrl: `https://procolis.com/suivi/${encodeURIComponent(tracking)}`,
      costMinor: null,
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

    const response = await this.http(`${API_BASE}/lire`, {
      method: 'POST',
      headers: this.headers(credentials),
      body: JSON.stringify({ Colis: trackingNumbers.map((tracking) => ({ Tracking: tracking })) }),
    });

    const parsed = await readJson<ZrStatusResponse>(this.key, response);
    return (parsed.Colis ?? []).map((entry) => this.toUpdate(entry));
  }

  async fetchLabel(): Promise<CourierLabel> {
    // ZR prints its own labels at the counter; we print ours.
    throw new CourierUnsupportedError(this.key, 'label fetching');
  }

  async cancel(): Promise<void> {
    throw new CourierUnsupportedError(this.key, 'cancellation');
  }

  async parseWebhook(): Promise<CourierTrackingUpdate[]> {
    throw new CourierWebhookError('ZR Express does not send webhooks; it is polled');
  }

  toUpdate(entry: NonNullable<ZrStatusResponse['Colis']>[number]): CourierTrackingUpdate {
    const situation = (entry.Situation ?? '').trim();
    const status = STATUS_MAP[situation] ?? ShipmentStatus.IN_TRANSIT;
    const received = entry.MontantRecu;

    return {
      trackingNumber: entry.Tracking,
      status,
      rawStatus: situation || 'inconnu',
      message: entry.Commentaire ?? null,
      failureReason:
        status === ShipmentStatus.FAILED || status === ShipmentStatus.RETURNED
          ? mapReason(entry.Commentaire ?? situation)
          : null,
      occurredAt: parseDate(entry.DateH ?? ''),
      // Whole dinars on the way in, centimes everywhere after this line.
      codCollectedMinor:
        received === undefined || received === null || received === ''
          ? null
          : BigInt(Math.round(Number(received) * 100)),
    };
  }

  private headers(credentials: CourierCredentials): Record<string, string> {
    return {
      token: credentials.token ?? '',
      key: credentials.key ?? '',
      'Content-Type': 'application/json',
    };
  }
}
