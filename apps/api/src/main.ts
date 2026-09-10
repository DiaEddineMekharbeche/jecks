import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  // `rawBody` keeps the original bytes on the request. Every webhook signature is an
  // HMAC over exactly what was sent, and a body that has been through JSON.parse and
  // back is a different string that would never verify.
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  const config: ConfigService<Env, true> = app.get(ConfigService);

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use(compression());
  app.use(
    helmet({
      // The storefront serves media from a different origin (MinIO/R2), and Swagger UI
      // needs inline styles, so CSP is set at the edge (Nginx) rather than here.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Credentialed requests need an explicit origin list; the refresh cookie rides on them.
  app.enableCors({
    origin: splitOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
    exposedHeaders: ['x-correlation-id'],
  });

  app.enableShutdownHooks();

  const nodeEnv = config.get('NODE_ENV', { infer: true });
  if (nodeEnv !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("Jeck's API")
        .setDescription('Caps e-commerce platform — storefront, admin and webhooks')
        .setVersion('1.0')
        .addBearerAuth()
        .addCookieAuth('jk_refresh')
        .build(),
    );
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = config.get('API_PORT', { infer: true });
  const host = config.get('API_HOST', { infer: true });

  // Omitting the host makes Node bind `::` dual-stack, so `localhost` reaches the API
  // whether the client resolves it to ::1 or 127.0.0.1. Binding `0.0.0.0` listens on
  // IPv4 only, and browsers on Windows try ::1 first — the request is refused before it
  // leaves the machine. Node falls back to 0.0.0.0 by itself where IPv6 is unavailable,
  // which is what containers need. Set API_HOST to pin it.
  if (host) await app.listen(port, host);
  else await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${port}/api/v1`);
  if (nodeEnv !== 'production') logger.log(`API docs on http://localhost:${port}/docs`);
}

function splitOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

void bootstrap();
