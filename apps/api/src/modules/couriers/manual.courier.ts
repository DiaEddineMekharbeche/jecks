import { Injectable } from '@nestjs/common';
import { ShipmentStatus } from '@jecks/db';
import {
  CourierUnsupportedError,
  type CourierCredentials,
  type CourierLabel,
  type CourierParcel,
  type CourierProvider,
  type CourierShipmentResult,
  type CourierTrackingUpdate,
} from './courier-provider.js';

/**
 * The manual courier — PRD F-AD-61, and the default every shop starts on.
 *
 * This is not a null object. Most Algerian shops drop parcels at a courier's counter,
 * get a handwritten receipt, and type the tracking numbers back in from a spreadsheet
 * that evening. That is a real workflow, and it is this adapter: the shipment is created
 * immediately, tracking arrives later through the import, and status changes are made by
 * a human in the admin.
 *
 * It refuses to invent what it does not know. There is no API to ask, so `track` returns
 * nothing rather than guessing that a parcel is probably in transit by now.
 */
@Injectable()
export class ManualCourier implements CourierProvider {
  readonly key = 'manual';
  readonly label = 'Remise en main propre';
  readonly supportsWebhook = false;
  readonly supportsLabel = true;
  readonly supportsCancel = true;
  readonly requiredCredentials = [] as const;

  async createShipment(parcel: CourierParcel): Promise<CourierShipmentResult> {
    return {
      // The courier allocates their own number at the counter; ours is the order number.
      trackingNumber: null,
      trackingUrl: null,
      costMinor: null,
      labelUrl: null,
      status: ShipmentStatus.CREATED,
      raw: { manual: true, orderNumber: parcel.orderNumber },
    };
  }

  async track(): Promise<CourierTrackingUpdate[]> {
    // Nobody to ask. The import and the admin are how this courier reports.
    return [];
  }

  async fetchLabel(): Promise<CourierLabel> {
    // Handled by the platform's own label renderer, which the shipping service calls
    // whenever the adapter has no label of its own.
    throw new CourierUnsupportedError(this.key, 'label fetching');
  }

  async cancel(): Promise<void> {
    // Cancelling is a phone call. Nothing to undo on our side beyond the row itself.
  }

  async parseWebhook(): Promise<CourierTrackingUpdate[]> {
    throw new CourierUnsupportedError(this.key, 'webhooks');
  }

  /**
   * Turns an imported spreadsheet row into the update the rest of the system applies.
   *
   * Kept here rather than in the service so the manual courier owns its own mapping,
   * exactly like the adapters that speak HTTP.
   */
  fromImport(row: {
    trackingNumber: string;
    status?: ShipmentStatus;
    occurredAt?: Date;
  }): CourierTrackingUpdate {
    return {
      trackingNumber: row.trackingNumber,
      status: row.status ?? ShipmentStatus.IN_TRANSIT,
      rawStatus: 'import',
      message: 'Importé depuis le fichier du transporteur',
      failureReason: null,
      occurredAt: row.occurredAt ?? new Date(),
      codCollectedMinor: null,
    };
  }

  /** Unused credentials, declared so the type matches the others. */
  static readonly credentials: CourierCredentials = {};
}
