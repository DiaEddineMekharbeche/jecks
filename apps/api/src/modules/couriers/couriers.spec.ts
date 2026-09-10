import { createHmac } from 'node:crypto';
import { DeliveryFailureReason, ShipmentStatus } from '@jecks/db';
import { describe, expect, it, vi } from 'vitest';
import {
  CourierConfigurationError,
  CourierRequestError,
  CourierUnsupportedError,
  CourierWebhookError,
  requireCredentials,
  type CourierHttpClient,
  type CourierParcel,
} from './courier-provider.js';
import { EmsCourier } from './ems.courier.js';
import { ManualCourier } from './manual.courier.js';
import { MaystroCourier, constantTimeEquals, headerValue } from './maystro.courier.js';
import { YalidineCourier, mapReason, parseDate } from './yalidine.courier.js';
import { ZrExpressCourier } from './zrexpress.courier.js';

/**
 * Every adapter, against a stubbed HTTP client.
 *
 * These tests exist because the alternative is finding out that a request builder is
 * wrong when a real parcel goes to the wrong wilaya. They assert the things that
 * actually break: units, address fields, status mapping and signature verification.
 */

const parcel: CourierParcel = {
  orderId: '018f-order',
  orderNumber: 'JK-260910-0042',
  customerName: 'Yacine Benali',
  customerPhone: '+213551234567',
  altPhone: '+213661234567',
  address: 'Cité 300 logements, bât C',
  wilayaCode: 16,
  wilayaName: 'Alger',
  communeName: 'Bab Ezzouar',
  pickupPointCode: null,
  isStopDesk: false,
  codAmountMinor: 480_000n,
  weightGrams: 1400,
  itemCount: 2,
  contents: 'Casquette Heritage x2',
  note: 'Appeler avant',
};

function stub(
  status: number,
  body: unknown,
): { calls: Array<{ url: string; init: RequestInit }>; http: CourierHttpClient } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const http = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }) as unknown as CourierHttpClient;
  return { calls, http };
}

/**
 * The JSON an adapter actually sent, so a test can assert on one field of it.
 *
 * Indexable by name and by number, because some of these APIs take a bare array of
 * parcels and others wrap them in an object.
 */
type SentJson = { [key: string]: SentJson } & { [index: number]: SentJson };

const body = (calls: Array<{ init: RequestInit }>, index = 0): SentJson =>
  JSON.parse(String(calls[index]!.init.body)) as SentJson;

// --- shared helpers ---------------------------------------------------------

describe('requireCredentials', () => {
  it('names every missing key', () => {
    expect(() => requireCredentials('test', { a: '1' }, ['a', 'b', 'c'])).toThrow(/b, c/);
  });

  it('treats whitespace as missing', () => {
    expect(() => requireCredentials('test', { a: '   ' }, ['a'])).toThrow(CourierConfigurationError);
  });

  it('passes when everything is set', () => {
    expect(() => requireCredentials('test', { a: '1' }, ['a'])).not.toThrow();
  });
});

describe('parseDate', () => {
  it('reads an Algiers timestamp as UTC+1', () => {
    // 14:32 in Algiers is 13:32 UTC.
    expect(parseDate('2026-09-10 14:32:07').toISOString()).toBe('2026-09-10T13:32:07.000Z');
  });

  it('respects an explicit zone', () => {
    expect(parseDate('2026-09-10T13:32:07Z').toISOString()).toBe('2026-09-10T13:32:07.000Z');
  });

  it('falls back to now on nonsense rather than an invalid date', () => {
    expect(Number.isNaN(parseDate('not a date').getTime())).toBe(false);
    expect(Number.isNaN(parseDate('').getTime())).toBe(false);
  });
});

describe('mapReason', () => {
  it('recognises the common French failures', () => {
    expect(mapReason('Client injoignable')).toBe(DeliveryFailureReason.NO_ANSWER);
    expect(mapReason('Colis refusé')).toBe(DeliveryFailureReason.REFUSED);
    expect(mapReason('Adresse erronée')).toBe(DeliveryFailureReason.WRONG_ADDRESS);
    expect(mapReason('Client absent')).toBe(DeliveryFailureReason.CUSTOMER_ABSENT);
    expect(mapReason('Livraison reportée')).toBe(DeliveryFailureReason.RESCHEDULED);
  });

  it('falls back to OTHER rather than guessing', () => {
    expect(mapReason('quelque chose')).toBe(DeliveryFailureReason.OTHER);
  });
});

// --- manual -----------------------------------------------------------------

describe('ManualCourier', () => {
  const manual = new ManualCourier();

  it('creates a shipment with no tracking number', async () => {
    const result = await manual.createShipment(parcel);
    expect(result.trackingNumber).toBeNull();
    expect(result.status).toBe(ShipmentStatus.CREATED);
  });

  it('needs no credentials', () => {
    expect(manual.requiredCredentials).toEqual([]);
  });

  it('reports nothing rather than guessing progress', async () => {
    expect(await manual.track()).toEqual([]);
  });

  it('maps an imported row onto an update', () => {
    const update = manual.fromImport({ trackingNumber: 'YAL-9', status: ShipmentStatus.DELIVERED });
    expect(update.status).toBe(ShipmentStatus.DELIVERED);
    expect(update.trackingNumber).toBe('YAL-9');
  });

  it('assumes an import without a status means the parcel is moving', () => {
    expect(manual.fromImport({ trackingNumber: 'X' }).status).toBe(ShipmentStatus.IN_TRANSIT);
  });

  it('refuses webhooks and label fetching', async () => {
    await expect(manual.parseWebhook()).rejects.toThrow(CourierUnsupportedError);
    await expect(manual.fetchLabel()).rejects.toThrow(CourierUnsupportedError);
  });
});

// --- yalidine ---------------------------------------------------------------

describe('YalidineCourier', () => {
  const credentials = { apiId: 'id', apiToken: 'token' };

  it('sends whole dinars, never centimes', async () => {
    const { calls, http } = stub(200, { [parcel.orderNumber]: { success: true, tracking: 'yal-1' } });
    await new YalidineCourier(http).createShipment(parcel, credentials);
    expect(body(calls)[0].price).toBe(4800);
  });

  it('addresses by wilaya name, which is what their API takes', async () => {
    const { calls, http } = stub(200, { [parcel.orderNumber]: { success: true, tracking: 'yal-1' } });
    await new YalidineCourier(http).createShipment(parcel, credentials);
    expect(body(calls)[0].to_wilaya_name).toBe('Alger');
    expect(body(calls)[0].to_commune_name).toBe('Bab Ezzouar');
  });

  it('splits the customer name the way their form expects', async () => {
    const { calls, http } = stub(200, { [parcel.orderNumber]: { success: true, tracking: 'yal-1' } });
    await new YalidineCourier(http).createShipment(parcel, credentials);
    expect(body(calls)[0].firstname).toBe('Yacine');
    expect(body(calls)[0].familyname).toBe('Benali');
  });

  it('sends the API credentials in their headers', async () => {
    const { calls, http } = stub(200, { [parcel.orderNumber]: { success: true, tracking: 'yal-1' } });
    await new YalidineCourier(http).createShipment(parcel, credentials);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['X-API-ID']).toBe('id');
    expect(headers['X-API-TOKEN']).toBe('token');
  });

  it('refuses a parcel their 200 marked unsuccessful', async () => {
    const { http } = stub(200, {
      [parcel.orderNumber]: { success: false, message: 'to_commune_name invalid' },
    });
    await expect(new YalidineCourier(http).createShipment(parcel, credentials)).rejects.toThrow(
      /to_commune_name invalid/,
    );
  });

  it('refuses without credentials before making a request', async () => {
    const { calls, http } = stub(200, {});
    await expect(new YalidineCourier(http).createShipment(parcel, {})).rejects.toThrow(
      CourierConfigurationError,
    );
    expect(calls).toHaveLength(0);
  });

  it('maps delivery and return to the right statuses', () => {
    const yalidine = new YalidineCourier();
    expect(
      yalidine.toUpdate({ tracking: 't', status: 'Livré', date_status: '2026-09-10 10:00:00' }).status,
    ).toBe(ShipmentStatus.DELIVERED);
    expect(
      yalidine.toUpdate({ tracking: 't', status: 'Retourné au vendeur', date_status: '2026-09-10 10:00:00' })
        .status,
    ).toBe(ShipmentStatus.RETURNED);
    expect(
      yalidine.toUpdate({ tracking: 't', status: 'Sorti en livraison', date_status: '2026-09-10 10:00:00' })
        .status,
    ).toBe(ShipmentStatus.OUT_FOR_DELIVERY);
  });

  it('treats an unknown status as movement, never as an outcome', () => {
    const update = new YalidineCourier().toUpdate({
      tracking: 't',
      status: 'Quelque chose de nouveau',
      date_status: '2026-09-10 10:00:00',
    });
    expect(update.status).toBe(ShipmentStatus.IN_TRANSIT);
    expect(update.rawStatus).toBe('Quelque chose de nouveau');
  });

  it('attaches a failure reason only to a failure', () => {
    const yalidine = new YalidineCourier();
    const failed = yalidine.toUpdate({
      tracking: 't',
      status: 'Echec livraison',
      date_status: '2026-09-10 10:00:00',
      reason: 'Client injoignable',
    });
    expect(failed.failureReason).toBe(DeliveryFailureReason.NO_ANSWER);

    const delivered = yalidine.toUpdate({ tracking: 't', status: 'Livré', date_status: '2026-09-10 10:00:00' });
    expect(delivered.failureReason).toBeNull();
  });

  it('asks for nothing when there is nothing to track', async () => {
    const { calls, http } = stub(200, { data: [] });
    expect(await new YalidineCourier(http).track([], credentials)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('refuses to accept a webhook it cannot verify', async () => {
    await expect(new YalidineCourier().parseWebhook()).rejects.toThrow(CourierWebhookError);
  });

  it('surfaces an HTTP failure with the courier own words', async () => {
    const { http } = stub(422, 'to_wilaya_name is required');
    await expect(new YalidineCourier(http).createShipment(parcel, credentials)).rejects.toThrow(
      CourierRequestError,
    );
  });
});

// --- ZR Express -------------------------------------------------------------

describe('ZrExpressCourier', () => {
  const credentials = { token: 't', key: 'k' };

  it('addresses by wilaya code, not name', async () => {
    const { calls, http } = stub(200, { Colis: [{ Tracking: 'JK-260910-0042', MessageRetour: 'Good' }] });
    await new ZrExpressCourier(http).createShipment(parcel, credentials);
    expect(body(calls).Colis[0].IDWilaya).toBe('16');
  });

  it('sends whole dinars', async () => {
    const { calls, http } = stub(200, { Colis: [{ Tracking: 'x', MessageRetour: 'Good' }] });
    await new ZrExpressCourier(http).createShipment(parcel, credentials);
    expect(body(calls).Colis[0].Total).toBe('4800');
  });

  it('carries the second phone number', async () => {
    const { calls, http } = stub(200, { Colis: [{ Tracking: 'x', MessageRetour: 'Good' }] });
    await new ZrExpressCourier(http).createShipment(parcel, credentials);
    expect(body(calls).Colis[0].MobileB).toBe('+213661234567');
  });

  it('marks a stop-desk parcel with their delivery type', async () => {
    const { calls, http } = stub(200, { Colis: [{ Tracking: 'x', MessageRetour: 'Good' }] });
    await new ZrExpressCourier(http).createShipment({ ...parcel, isStopDesk: true }, credentials);
    expect(body(calls).Colis[0].TypeLivraison).toBe('1');
  });

  it('treats a non-Good message as a refusal', async () => {
    const { http } = stub(200, { Colis: [{ MessageRetour: 'Tracking déjà utilisé' }] });
    await expect(new ZrExpressCourier(http).createShipment(parcel, credentials)).rejects.toThrow(
      /déjà utilisé/,
    );
  });

  it('converts the collected amount from dinars to centimes', () => {
    const update = new ZrExpressCourier().toUpdate({
      Tracking: 'x',
      Situation: 'Livré',
      MontantRecu: '4800',
      DateH: '2026-09-10 12:00:00',
    });
    expect(update.codCollectedMinor).toBe(480_000n);
    expect(update.status).toBe(ShipmentStatus.DELIVERED);
  });

  it('reports no collection rather than zero when the field is absent', () => {
    const update = new ZrExpressCourier().toUpdate({ Tracking: 'x', Situation: 'Vers Wilaya' });
    expect(update.codCollectedMinor).toBeNull();
  });

  it('has no label or cancellation to offer, and says so', async () => {
    const zr = new ZrExpressCourier();
    await expect(zr.fetchLabel()).rejects.toThrow(CourierUnsupportedError);
    await expect(zr.cancel()).rejects.toThrow(CourierUnsupportedError);
  });
});

// --- Maystro ----------------------------------------------------------------

describe('MaystroCourier', () => {
  const credentials = { apiKey: 'secret-key' };

  it('authenticates with a token header', async () => {
    const { calls, http } = stub(200, { tracking_number: 'MY-1' });
    await new MaystroCourier(http).createShipment(parcel, credentials);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Token secret-key');
  });

  it('sends whole dinars and the wilaya code', async () => {
    const { calls, http } = stub(200, { tracking_number: 'MY-1' });
    await new MaystroCourier(http).createShipment(parcel, credentials);
    expect(body(calls).product_price).toBe(4800);
    expect(body(calls).wilaya).toBe(16);
  });

  it('refuses a response with no tracking number', async () => {
    const { http } = stub(200, { detail: 'wilaya not served' });
    await expect(new MaystroCourier(http).createShipment(parcel, credentials)).rejects.toThrow(
      /wilaya not served/,
    );
  });

  it('accepts a correctly signed webhook', async () => {
    const payload = JSON.stringify({ tracking_number: 'MY-1', status: 41, updated_at: '2026-09-10T10:00:00Z' });
    const signature = createHmac('sha256', 'secret-key').update(payload, 'utf8').digest('hex');

    const updates = await new MaystroCourier().parseWebhook(
      payload,
      { 'x-maystro-signature': signature },
      credentials,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]!.status).toBe(ShipmentStatus.DELIVERED);
  });

  it('accepts the sha256= prefix some senders add', async () => {
    const payload = JSON.stringify({ tracking_number: 'MY-1', status: 41 });
    const signature = createHmac('sha256', 'secret-key').update(payload, 'utf8').digest('hex');
    await expect(
      new MaystroCourier().parseWebhook(payload, { 'x-signature': `sha256=${signature}` }, credentials),
    ).resolves.toHaveLength(1);
  });

  it('rejects a forged signature', async () => {
    const payload = JSON.stringify({ tracking_number: 'MY-1', status: 41 });
    await expect(
      new MaystroCourier().parseWebhook(payload, { 'x-maystro-signature': 'deadbeef' }, credentials),
    ).rejects.toThrow(CourierWebhookError);
  });

  it('rejects a webhook with no signature at all', async () => {
    await expect(new MaystroCourier().parseWebhook('{}', {}, credentials)).rejects.toThrow(
      /no signature/i,
    );
  });

  it('rejects a webhook when nothing is configured to verify it', async () => {
    await expect(new MaystroCourier().parseWebhook('{}', { 'x-signature': 'x' }, {})).rejects.toThrow(
      /no webhook secret/i,
    );
  });

  it('verifies against the raw body, so a re-serialised payload fails', async () => {
    const payload = '{"tracking_number":"MY-1","status":41}';
    const signature = createHmac('sha256', 'secret-key').update(payload, 'utf8').digest('hex');
    const reserialised = JSON.stringify(JSON.parse(payload).status === 41 ? { status: 41, tracking_number: 'MY-1' } : {});

    await expect(
      new MaystroCourier().parseWebhook(reserialised, { 'x-signature': signature }, credentials),
    ).rejects.toThrow(CourierWebhookError);
  });

  it('handles a batch of events in one webhook', async () => {
    const payload = JSON.stringify([
      { tracking_number: 'A', status: 41 },
      { tracking_number: 'B', status: 50 },
    ]);
    const signature = createHmac('sha256', 'secret-key').update(payload, 'utf8').digest('hex');

    const updates = await new MaystroCourier().parseWebhook(
      payload,
      { 'x-signature': signature },
      credentials,
    );
    expect(updates.map((update) => update.status)).toEqual([
      ShipmentStatus.DELIVERED,
      ShipmentStatus.RETURNED,
    ]);
  });

  it('converts a collected amount into centimes', () => {
    const update = new MaystroCourier().toUpdate(
      { tracking_number: 'MY-1', status: 41, collected_amount: 4800 },
      'MY-1',
    );
    expect(update.codCollectedMinor).toBe(480_000n);
  });
});

describe('webhook helpers', () => {
  it('reads a header whatever its case', () => {
    expect(headerValue({ 'X-Signature': 'a' }, 'x-signature')).toBe('a');
    expect(headerValue({ 'x-signature': 'a' }, 'X-Signature')).toBe('a');
  });

  it('takes the first value of a repeated header', () => {
    expect(headerValue({ 'x-signature': ['a', 'b'] }, 'x-signature')).toBe('a');
  });

  it('returns null when the header is absent', () => {
    expect(headerValue({}, 'x-signature')).toBeNull();
  });

  it('compares in constant time without throwing on a length mismatch', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });
});

// --- EMS --------------------------------------------------------------------

describe('EmsCourier', () => {
  const credentials = { accountNumber: '12345', password: 'pw' };

  it('authenticates with HTTP basic', async () => {
    const { calls, http } = stub(200, { success: true, data: { barcode: 'EE123DZ' } });
    await new EmsCourier(http).createShipment(parcel, credentials);
    const auth = (calls[0]!.init.headers as Record<string, string>).Authorization;
    expect(Buffer.from(auth.replace('Basic ', ''), 'base64').toString()).toBe('12345:pw');
  });

  it('sends whole dinars and a minimum weight', async () => {
    const { calls, http } = stub(200, { success: true, data: { barcode: 'EE1' } });
    await new EmsCourier(http).createShipment({ ...parcel, weightGrams: 10 }, credentials);
    expect(body(calls).parcel.cod_amount).toBe(4800);
    expect(body(calls).parcel.weight_grams).toBe(100);
  });

  it('picks up the fee they quote, in centimes', async () => {
    const { http } = stub(200, { success: true, data: { barcode: 'EE1', fee: 620 } });
    const result = await new EmsCourier(http).createShipment(parcel, credentials);
    expect(result.costMinor).toBe(62_000n);
  });

  it('reports no cost when they do not quote one', async () => {
    const { http } = stub(200, { success: true, data: { barcode: 'EE1' } });
    expect((await new EmsCourier(http).createShipment(parcel, credentials)).costMinor).toBeNull();
  });

  it('names the service by delivery type', async () => {
    const { calls, http } = stub(200, { success: true, data: { barcode: 'EE1' } });
    await new EmsCourier(http).createShipment({ ...parcel, isStopDesk: true }, credentials);
    expect(body(calls).service).toBe('BUREAU');
  });

  it('maps the UPU event codes', () => {
    const ems = new EmsCourier();
    expect(ems.toUpdate({ barcode: 'b', event_code: 'EDB', event_date: '2026-09-10T10:00:00Z' }).status).toBe(
      ShipmentStatus.DELIVERED,
    );
    expect(ems.toUpdate({ barcode: 'b', event_code: 'EDA', event_date: '2026-09-10T10:00:00Z' }).status).toBe(
      ShipmentStatus.OUT_FOR_DELIVERY,
    );
    expect(ems.toUpdate({ barcode: 'b', event_code: 'EDC', event_date: '2026-09-10T10:00:00Z' }).status).toBe(
      ShipmentStatus.RETURNED,
    );
  });

  it('treats an unrecognised event as movement', () => {
    const update = new EmsCourier().toUpdate({ barcode: 'b', event_code: 'ZZZ', event_date: '' });
    expect(update.status).toBe(ShipmentStatus.IN_TRANSIT);
  });

  it('refuses a rejected shipment', async () => {
    const { http } = stub(200, { success: false, message: 'Compte suspendu' });
    await expect(new EmsCourier(http).createShipment(parcel, credentials)).rejects.toThrow(/suspendu/);
  });
});

// --- polling and the rest of the surface ------------------------------------

/**
 * The paths the `courier.sync` job uses.
 *
 * Creating a parcel is the part everyone tests and the part that fails loudly. Tracking
 * is the part that runs unattended every ten minutes, so a query built wrong here is a
 * shop that silently stops learning what happened to its parcels.
 */
describe('tracking and cancellation', () => {
  it('Yalidine asks for the histories of the numbers it was given', async () => {
    const { calls, http } = stub(200, {
      data: [{ tracking: 'yal-1', status: 'Livré', date_status: '2026-09-10 12:00:00' }],
    });

    const updates = await new YalidineCourier(http).track(['yal-1', 'yal-2'], {
      apiId: 'id',
      apiToken: 'token',
    });

    expect(calls[0]!.url).toContain('tracking=yal-1%2Cyal-2');
    expect(updates[0]!.status).toBe(ShipmentStatus.DELIVERED);
  });

  it('Yalidine returns the label bytes', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake');
    const http = (async () => ({
      ok: true,
      status: 200,
      text: async () => pdf.toString('binary'),
      arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength),
    })) as unknown as CourierHttpClient;

    const label = await new YalidineCourier(http).fetchLabel('yal-1', {
      apiId: 'id',
      apiToken: 'token',
    });

    expect(label.contentType).toBe('application/pdf');
    expect(label.filename).toBe('yal-1.pdf');
    expect(label.content.toString()).toContain('%PDF');
  });

  it('Yalidine reports a label it could not fetch', async () => {
    const { http } = stub(404, 'not found');
    await expect(
      new YalidineCourier(http).fetchLabel('yal-1', { apiId: 'id', apiToken: 'token' }),
    ).rejects.toThrow(CourierRequestError);
  });

  it('Yalidine cancels with a DELETE', async () => {
    const { calls, http } = stub(200, {});
    await new YalidineCourier(http).cancel('yal-1', { apiId: 'id', apiToken: 'token' });
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls[0]!.url).toContain('/parcels/yal-1');
  });

  it('Yalidine surfaces a refused cancellation', async () => {
    const { http } = stub(409, 'already shipped');
    await expect(
      new YalidineCourier(http).cancel('yal-1', { apiId: 'id', apiToken: 'token' }),
    ).rejects.toThrow(CourierRequestError);
  });

  it('ZR posts the tracking numbers as a Colis array', async () => {
    const { calls, http } = stub(200, {
      Colis: [{ Tracking: 'zr-1', Situation: 'Livré', MontantRecu: 4800 }],
    });

    const updates = await new ZrExpressCourier(http).track(['zr-1'], { token: 't', key: 'k' });

    expect(body(calls).Colis[0].Tracking).toBe('zr-1');
    expect(updates[0]!.codCollectedMinor).toBe(480_000n);
  });

  it('ZR asks for nothing when there is nothing open', async () => {
    const { calls, http } = stub(200, { Colis: [] });
    expect(await new ZrExpressCourier(http).track([], { token: 't', key: 'k' })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('ZR refuses to track without credentials', async () => {
    const { http } = stub(200, {});
    await expect(new ZrExpressCourier(http).track(['zr-1'], {})).rejects.toThrow(
      CourierConfigurationError,
    );
  });

  it('Maystro asks per tracking number', async () => {
    const { calls, http } = stub(200, {
      results: [{ tracking_number: 'my-1', status: 41, updated_at: '2026-09-10T10:00:00Z' }],
    });

    const updates = await new MaystroCourier(http).track(['my-1', 'my-2'], { apiKey: 'k' });

    expect(calls).toHaveLength(2);
    expect(updates).toHaveLength(2);
    expect(updates[0]!.status).toBe(ShipmentStatus.DELIVERED);
  });

  it('Maystro cancels with a DELETE', async () => {
    const { calls, http } = stub(204, '');
    await new MaystroCourier(http).cancel('my-1', { apiKey: 'k' });
    expect(calls[0]!.init.method).toBe('DELETE');
  });

  it('Maystro reports a refused cancellation', async () => {
    const { http } = stub(400, 'already delivered');
    await expect(new MaystroCourier(http).cancel('my-1', { apiKey: 'k' })).rejects.toThrow(
      CourierRequestError,
    );
  });

  it('Maystro has no label of its own', async () => {
    await expect(new MaystroCourier().fetchLabel()).rejects.toThrow(CourierUnsupportedError);
  });

  it('EMS asks for a batch of barcodes', async () => {
    const { calls, http } = stub(200, {
      data: [{ barcode: 'EE1', event_code: 'EDB', event_date: '2026-09-10T10:00:00Z' }],
    });

    const updates = await new EmsCourier(http).track(['EE1', 'EE2'], {
      accountNumber: '1',
      password: 'p',
    });

    expect(calls[0]!.url).toContain('barcodes=EE1%2CEE2');
    expect(updates[0]!.status).toBe(ShipmentStatus.DELIVERED);
  });

  it('EMS asks for nothing when there is nothing open', async () => {
    const { calls, http } = stub(200, { data: [] });
    expect(await new EmsCourier(http).track([], { accountNumber: '1', password: 'p' })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('EMS refuses webhooks and cancellation rather than pretending', async () => {
    const ems = new EmsCourier();
    await expect(ems.parseWebhook()).rejects.toThrow(CourierWebhookError);
    await expect(ems.cancel()).rejects.toThrow(CourierUnsupportedError);
  });

  it('EMS carries the second phone number when there is one', async () => {
    const { calls, http } = stub(200, { success: true, data: { barcode: 'EE1' } });
    await new EmsCourier(http).createShipment(parcel, { accountNumber: '1', password: 'p' });
    expect(body(calls).recipient.alt_phone).toBe('+213661234567');
  });
});
