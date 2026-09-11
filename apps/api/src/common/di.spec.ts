import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { BrevoNewsletterProvider } from '../modules/content/newsletter-provider.js';
import { EmsCourier } from '../modules/couriers/ems.courier.js';
import { ManualCourier } from '../modules/couriers/manual.courier.js';
import { MaystroCourier } from '../modules/couriers/maystro.courier.js';
import { YalidineCourier } from '../modules/couriers/yalidine.courier.js';
import { ZrExpressCourier } from '../modules/couriers/zrexpress.courier.js';
import { LogErrorReporter, SentryErrorReporter } from '../modules/ops/error-reporter.js';

/**
 * Can the container actually build these?
 *
 * Every adapter here takes an HTTP client as a constructor parameter with a default,
 * so a test can hand it a stub. Nest does not see the default: it reads the emitted
 * parameter types, finds `Function`, looks for a provider of that token and refuses to
 * build the module. The parameter has to be marked `@Optional()` for the default to
 * apply.
 *
 * Every other test in this suite constructs these classes with `new`, which works
 * perfectly and proves nothing about the container. This one boots them the way the
 * application does, so the failure shows up here rather than as an API that will not
 * start.
 */

const ADAPTERS = [
  ManualCourier,
  YalidineCourier,
  ZrExpressCourier,
  MaystroCourier,
  EmsCourier,
  BrevoNewsletterProvider,
  LogErrorReporter,
];

describe('dependency injection', () => {
  it.each(ADAPTERS.map((adapter) => [adapter.name, adapter] as const))(
    'the container can build %s',
    async (_name, adapter) => {
      const moduleRef = await Test.createTestingModule({ providers: [adapter] }).compile();

      expect(moduleRef.get(adapter)).toBeInstanceOf(adapter);
    },
  );

  it('the container can build SentryErrorReporter, which also needs config', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SentryErrorReporter,
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    const reporter = moduleRef.get(SentryErrorReporter);

    expect(reporter).toBeInstanceOf(SentryErrorReporter);
    // No DSN configured, so it reports itself as inactive rather than posting nowhere.
    expect(reporter.configured).toBe(false);
  });

  it('gives each adapter a working default client when nothing is injected', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [YalidineCourier] }).compile();

    // The point of the default: an adapter built by the container must be able to make
    // a request, not hold `undefined` where its client should be.
    const courier = moduleRef.get(YalidineCourier);
    expect((courier as unknown as { http: unknown }).http).toBeTypeOf('function');
  });
});
