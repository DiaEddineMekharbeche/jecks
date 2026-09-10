import { Module } from '@nestjs/common';
import { CourierRegistry } from './courier-registry.service.js';
import { EmsCourier } from './ems.courier.js';
import { ManualCourier } from './manual.courier.js';
import { MaystroCourier } from './maystro.courier.js';
import { YalidineCourier } from './yalidine.courier.js';
import { ZrExpressCourier } from './zrexpress.courier.js';

/**
 * The courier adapters — PRD F-AD-61.
 *
 * Every adapter is registered whether or not the shop uses it: the registry needs to be
 * able to name them all so Settings can offer the list, and an adapter without
 * credentials simply refuses to act.
 */
@Module({
  providers: [
    ManualCourier,
    YalidineCourier,
    ZrExpressCourier,
    MaystroCourier,
    EmsCourier,
    CourierRegistry,
  ],
  exports: [CourierRegistry, ManualCourier],
})
export class CouriersModule {}
