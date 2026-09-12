import { inject } from 'vitest';

/**
 * Hands each worker the containers the global setup started.
 *
 * This runs before any module is imported, which matters: `ConfigModule` reads
 * `process.env` once at boot, so the URLs have to be in place before the first
 * `AppModule` import rather than inside a test.
 *
 * The secrets here are throwaway and deliberately obvious. They exist because the API
 * refuses to start without them, which is the correct behaviour and one the harness
 * should not work around by disabling validation.
 */

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-at-least-32-chars';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-at-least-32-chars';
process.env.CREDENTIALS_KEY ??= 'aW50ZWdyYXRpb24tdGVzdC1rZXktMzItYnl0ZXMh';
process.env.INTERNAL_API_TOKEN ??= 'integration-internal-token-32-characters';

// The local driver writes renditions to disk; a temp directory keeps the repo clean.
process.env.STORAGE_DRIVER ??= 'local';
process.env.LOCAL_STORAGE_DIR ??= './.integration-storage';

process.env.COOKIE_SECURE ??= 'false';
