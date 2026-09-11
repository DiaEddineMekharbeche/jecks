import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import { AuditInterceptor } from './common/interceptors/audit.interceptor.js';
import { CsrfGuard } from './common/guards/csrf.guard.js';
import { IdempotencyGuard } from './common/idempotency/idempotency.guard.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';
import { CorrelationInterceptor } from './common/interceptors/correlation.interceptor.js';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor.js';
import { validateEnv } from './config/env.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CartModule } from './modules/cart/cart.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CatalogAdminModule } from './modules/catalog/admin/catalog-admin.module.js';
import { CacheInvalidationInterceptor } from './common/cache/cache-invalidation.interceptor.js';
import { CacheModule } from './common/cache/cache.module.js';
import { ListModule } from './common/list/list.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { CouriersModule } from './modules/couriers/couriers.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { DeliveryModule } from './modules/delivery/delivery.module.js';
import { FinanceModule } from './modules/finance/finance.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { ShippingModule } from './modules/shipping/shipping.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { LogErrorReporter, SentryErrorReporter } from './modules/ops/error-reporter.js';
import { OpsModule } from './modules/ops/ops.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { PromotionsModule } from './modules/promotions/promotions.module.js';
import { QueueModule } from './modules/queue/queue.module.js';
import { GlobalSearchModule } from './modules/search/global-search.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { StorefrontModule } from './modules/storefront/storefront.module.js';
import { SystemModule } from './modules/system/system.module.js';
import { ViewsModule } from './modules/views/views.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Read the repo-root .env so one file drives every app.
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    // Baseline rate limit; auth routes tighten it with @Throttle (PRD F-ST-44).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    // Global so the JwtAuthGuard registered below can verify tokens; secrets are
    // still passed per call, since access and refresh use different keys.
    JwtModule.register({ global: true }),
    PrismaModule,
    CacheModule,
    ListModule,
    QueueModule,
    StorageModule,
    SettingsModule,
    HealthModule,
    OpsModule,
    AuthModule,
    CatalogModule,
    CatalogAdminModule,
    PromotionsModule,
    CartModule,
    StorefrontModule,
    InventoryModule,
    SystemModule,
    ShippingModule,
    CouriersModule,
    DeliveryModule,
    ContentModule,
    CustomersModule,
    FinanceModule,
    MaintenanceModule,
    WebhooksModule,
    DashboardModule,
    MediaModule,
    OrdersModule,
    PaymentsModule,
    RealtimeModule,
    ViewsModule,
    GlobalSearchModule,
  ],
  providers: [
    // Order matters: correlation id first so the filter can quote it, then the envelope.
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    // Last, so it only fires for a response that actually made it out.
    { provide: APP_INTERCEPTOR, useClass: CacheInvalidationInterceptor },
    {
      // Sentry when a DSN is set, the log otherwise. Chosen once at boot rather than
      // per error, so a deployment behaves the same way for every failure.
      provide: APP_FILTER,
      inject: [LogErrorReporter, SentryErrorReporter],
      useFactory: (log: LogErrorReporter, sentry: SentryErrorReporter) =>
        new AllExceptionsFilter(sentry.configured ? sentry : log),
    },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Before authentication: a forged request must be refused whether or not its cookie
    // would have been accepted.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // After authentication, before permissions: an unauthenticated request should be
    // refused before it can hold an idempotency key.
    { provide: APP_GUARD, useClass: IdempotencyGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
