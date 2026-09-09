import { config as loadEnv } from 'dotenv';

/**
 * Loads the repo-root `.env` before anything else runs.
 *
 * This has to be a module rather than a statement in `main.ts`: ES module imports are
 * hoisted and evaluated before any statement in the importing file, so a `loadEnv()`
 * call in `main.ts` runs *after* `queues.ts` has already read `process.env.REDIS_URL`
 * and fallen back to the default. Importing this first makes the load part of the
 * module graph, in the right order.
 *
 * The monorepo keeps one `.env` at the root; a per-app copy drifts, and when it does
 * the worker silently reads a different storage driver than the API writes with.
 */
loadEnv({ path: new URL('../../../../.env', import.meta.url) });

export const ENV_LOADED = true;
