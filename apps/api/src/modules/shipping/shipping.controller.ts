import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { shippingQuoteSchema, type ShippingQuoteInput } from '@jecks/shared';
import { Public } from '../../common/decorators/auth.decorators.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { ShippingService } from './shipping.service.js';

@ApiTags('shipping')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Public()
  @Get('wilayas')
  @ApiOperation({ summary: 'The 58 wilayas, for the checkout selector' })
  wilayas() {
    return this.shipping.listWilayas();
  }

  @Public()
  @Get('wilayas/:code/communes')
  @ApiOperation({ summary: 'Communes of one wilaya' })
  communes(@Param('code', ParseIntPipe) code: number) {
    return this.shipping.listCommunes(code);
  }

  @Public()
  @Get('wilayas/:code/pickup-points')
  @ApiOperation({ summary: 'Stop-desk pickup points of one wilaya' })
  pickupPoints(@Param('code', ParseIntPipe) code: number) {
    return this.shipping.listPickupPoints(code);
  }

  @Public()
  @Get('quote')
  @ApiOperation({ summary: 'Delivery fee and ETA for a wilaya, delivery type and weight' })
  async quote(@Query(zod(shippingQuoteSchema)) query: ShippingQuoteInput) {
    const quote = await this.shipping.quote({
      wilayaCode: query.wilayaCode,
      deliveryType: query.deliveryType,
      weightGrams: query.weightGrams,
      subtotal: query.subtotal === undefined ? 0n : BigInt(query.subtotal),
    });
    // `cost` is what we pay the courier; shoppers never see our margin on delivery.
    const { cost: _cost, ...publicQuote } = quote;
    return publicQuote;
  }
}
