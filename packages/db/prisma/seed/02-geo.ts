import type { PrismaClient } from '@prisma/client';
import { COMMUNES } from './data/communes.js';
import { WILAYAS, ZONE_NAMES, ZONE_RATES } from './data/wilayas.js';
import { ascii, log, tr } from './util.js';

/**
 * Geography, shipping zones and rates, couriers, pickup points, warehouse and fleet.
 * Covers PRD F-AD-60 to F-AD-62.
 */
export async function seedGeo(prisma: PrismaClient): Promise<void> {
  // --- wilayas ---------------------------------------------------------------
  for (const wilaya of WILAYAS) {
    await prisma.wilaya.upsert({
      where: { code: wilaya.code },
      create: {
        code: wilaya.code,
        name: tr(wilaya.fr, wilaya.ar, wilaya.fr),
        nameAscii: ascii(wilaya.fr),
        latitude: wilaya.lat,
        longitude: wilaya.lng,
      },
      update: {
        name: tr(wilaya.fr, wilaya.ar, wilaya.fr),
        nameAscii: ascii(wilaya.fr),
        latitude: wilaya.lat,
        longitude: wilaya.lng,
      },
    });
  }
  log('wilayas', WILAYAS.length);

  // --- communes --------------------------------------------------------------
  for (const commune of COMMUNES) {
    const nameAscii = ascii(commune.fr);
    await prisma.commune.upsert({
      where: { wilayaCode_nameAscii: { wilayaCode: commune.wilaya, nameAscii } },
      create: {
        wilayaCode: commune.wilaya,
        name: tr(commune.fr, commune.ar, commune.fr),
        nameAscii,
      },
      update: { name: tr(commune.fr, commune.ar, commune.fr) },
    });
  }
  log('communes', COMMUNES.length);

  // --- shipping zones --------------------------------------------------------
  const zoneIds = new Map<number, string>();
  for (const zoneKey of [1, 2, 3, 4, 5, 6] as const) {
    const names = ZONE_NAMES[zoneKey];
    const codes = WILAYAS.filter((w) => w.zone === zoneKey).map((w) => w.code);
    const existing = await prisma.shippingZone.findFirst({ where: { position: zoneKey } });
    const zone = existing
      ? await prisma.shippingZone.update({
          where: { id: existing.id },
          data: { name: tr(names.fr, names.ar, names.en), wilayaCodes: codes },
        })
      : await prisma.shippingZone.create({
          data: { name: tr(names.fr, names.ar, names.en), wilayaCodes: codes, position: zoneKey },
        });
    zoneIds.set(zoneKey, zone.id);
  }
  log('shipping zones', zoneIds.size);

  // --- couriers --------------------------------------------------------------
  // Only the manual/CSV courier is implemented (PRD F-AD-61); the rest are
  // configured rows waiting for their adapter and API credentials.
  const couriers = [
    { slug: 'own-fleet', name: 'Flotte Jeck’s', provider: 'manual', codFeePercent: 0, settlementDays: 1 },
    { slug: 'yalidine', name: 'Yalidine', provider: 'yalidine', codFeePercent: 1, settlementDays: 7 },
    { slug: 'zr-express', name: 'ZR Express', provider: 'zr_express', codFeePercent: 1, settlementDays: 7 },
    { slug: 'maystro', name: 'Maystro Delivery', provider: 'maystro', codFeePercent: 1.5, settlementDays: 10 },
    { slug: 'ems', name: 'EMS Champion Post', provider: 'ems', codFeePercent: 0.5, settlementDays: 15 },
  ];

  const courierIds = new Map<string, string>();
  for (const courier of couriers) {
    const row = await prisma.courier.upsert({
      where: { slug: courier.slug },
      create: {
        slug: courier.slug,
        name: courier.name,
        provider: courier.provider,
        codFeePercent: courier.codFeePercent,
        settlementDays: courier.settlementDays,
        // Adapters other than `manual` stay inactive until credentials are entered.
        active: courier.provider === 'manual' || courier.slug === 'yalidine',
      },
      update: { name: courier.name, provider: courier.provider },
    });
    courierIds.set(courier.slug, row.id);
  }
  log('couriers', couriers.length);

  // --- shipping rates --------------------------------------------------------
  // One home rate and one stop-desk rate per wilaya for the two active couriers.
  const activeCouriers = ['own-fleet', 'yalidine'] as const;
  let rateCount = 0;
  for (const wilaya of WILAYAS) {
    const band = ZONE_RATES[wilaya.zone];
    for (const slug of activeCouriers) {
      const courierId = courierIds.get(slug);
      if (!courierId) continue;
      // The own fleet only serves the Centre; it is cheaper there and absent elsewhere.
      if (slug === 'own-fleet' && wilaya.zone !== 1) continue;
      const ownFleetDiscount = slug === 'own-fleet' ? 0.75 : 1;

      for (const deliveryType of ['HOME', 'STOP_DESK'] as const) {
        const isHome = deliveryType === 'HOME';
        await prisma.shippingRate.upsert({
          where: {
            wilayaCode_courierId_deliveryType: {
              wilayaCode: wilaya.code,
              courierId,
              deliveryType,
            },
          },
          create: {
            wilayaCode: wilaya.code,
            zoneId: zoneIds.get(wilaya.zone),
            courierId,
            deliveryType,
            price: BigInt(Math.round((isHome ? band.homePrice : band.deskPrice) * ownFleetDiscount)),
            cost: BigInt(Math.round((isHome ? band.homeCost : band.deskCost) * ownFleetDiscount)),
            etaMinDays: band.etaMin,
            etaMaxDays: band.etaMax,
            freeShippingThreshold: 600000n,
            extraPerKg: BigInt(isHome ? 10000 : 8000),
          },
          update: {},
        });
        rateCount += 1;
      }
    }
  }
  log('shipping rates', rateCount);

  // --- pickup points (stop-desks) -------------------------------------------
  const yalidineId = courierIds.get('yalidine');
  const deskWilayas = [16, 31, 25, 19, 9, 23, 6, 15, 5, 13, 30, 35, 42, 34, 27];
  let deskCount = 0;
  for (const code of deskWilayas) {
    const wilaya = WILAYAS.find((w) => w.code === code);
    if (!wilaya || !yalidineId) continue;
    const commune = await prisma.commune.findFirst({ where: { wilayaCode: code } });
    const name = `Stop Desk ${wilaya.fr}`;
    const existing = await prisma.pickupPoint.findFirst({ where: { name, wilayaCode: code } });
    if (existing) continue;
    await prisma.pickupPoint.create({
      data: {
        courierId: yalidineId,
        wilayaCode: code,
        communeId: commune?.id,
        name,
        address: `Agence ${wilaya.fr}, centre-ville`,
        phone: '+213770000000',
        openingHours: { mon_thu: '08:30-17:00', fri: 'closed', sat: '08:30-13:00' },
      },
    });
    deskCount += 1;
  }
  log('pickup points', deskCount);

  // --- warehouse locations ---------------------------------------------------
  const locations = [
    { code: 'MAIN', name: 'Entrepôt Bab Ezzouar', wilayaCode: 16, isDefault: true },
    { code: 'ORAN', name: 'Dépôt Oran', wilayaCode: 31, isDefault: false },
  ];
  for (const location of locations) {
    await prisma.location.upsert({
      where: { code: location.code },
      create: location,
      update: { name: location.name },
    });
  }
  log('locations', locations.length);

  // --- fleet -----------------------------------------------------------------
  const vehicles = [
    { plate: '16-12345-119', label: 'Renault Kangoo blanc', kind: 'van', capacityKg: 650 },
    { plate: '16-67890-121', label: 'Fiat Doblo gris', kind: 'van', capacityKg: 750 },
    { plate: '16-24680-118', label: 'Yamaha 125 livraison', kind: 'motorbike', capacityKg: 40 },
  ];
  for (const vehicle of vehicles) {
    await prisma.vehicle.upsert({
      where: { plate: vehicle.plate },
      create: vehicle,
      update: { label: vehicle.label },
    });
  }
  log('vehicles', vehicles.length);

  const driverUsers = await prisma.user.findMany({
    where: { email: { in: ['driver1@jecks.dz', 'driver2@jecks.dz'] } },
  });
  for (const [index, user] of driverUsers.entries()) {
    await prisma.driver.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        phone: user.phone ?? '+213661000000',
        wilayaCode: index === 0 ? 16 : 9,
      },
      update: {},
    });
  }
  log('drivers', driverUsers.length);
}
