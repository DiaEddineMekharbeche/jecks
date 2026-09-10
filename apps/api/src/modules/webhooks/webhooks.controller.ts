import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/auth.decorators.js';
import { NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { WebhooksService } from './webhooks.service.js';

/**
 * Inbound webhooks — PRD F-AD-61 and F-ST-45.
 *
 * Three rules hold for every endpoint here, and they are the reason this is one
 * controller rather than a handler bolted onto each module.
 *
 * The signature is verified against the *raw* body before a single field is read. Nest
 * is configured with `rawBody: true` so the bytes survive JSON parsing; a re-serialised
 * body produces a different HMAC and would fail on every honest sender.
 *
 * Nothing here reports failure to the sender beyond a status code. A courier that gets a
 * detailed error learns what our verification checks; more practically, most of them
 * retry forever on anything that is not a 2xx, so an unrecognised parcel is accepted
 * quietly rather than looping.
 *
 * They are public and unaudited: the caller has no session, and a courier that posts
 * every scan would drown the journal.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooks: WebhooksService) {}

  @Public()
  @NoAudit()
  @Post('couriers/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Courier status callback; the signature is checked first' })
  async courier(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: number; applied: number }> {
    const raw = rawBodyOf(request);
    return this.webhooks.handleCourier(provider, raw, headers);
  }

  @Public()
  @NoAudit()
  @ApiExcludeEndpoint()
  @Post('payments/:provider')
  @HttpCode(HttpStatus.OK)
  async payment(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: true }> {
    const raw = rawBodyOf(request);
    await this.webhooks.handlePayment(provider, raw, headers);
    return { ok: true };
  }
}

/**
 * The bytes exactly as they arrived.
 *
 * Falling back to re-serialising the parsed body would defeat the whole point: it would
 * make every signature check pass or fail on whitespace rather than on authenticity, so
 * a missing raw body is an error rather than a best effort.
 */
function rawBodyOf(request: RawBodyRequest<Request>): string {
  const raw = request.rawBody;
  if (!raw || raw.length === 0) {
    throw new BadRequestException({ code: 'EMPTY_BODY', message: 'No body to verify' });
  }
  return raw.toString('utf8');
}
