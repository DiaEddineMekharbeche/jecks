import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Starts `next dev` on the port from the repo-root .env.
 *
 * A `next dev -p ${STOREFRONT_PORT:-3000}` package script would be shorter, but that is
 * POSIX shell expansion and Windows runs npm scripts through cmd, where it is a literal
 * string. Doing it in Node keeps one command working everywhere.
 */
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../../.env') });

const port = process.env.STOREFRONT_PORT ?? '3000';

const child = spawn('next', ['dev', '-p', port], {
  stdio: 'inherit',
  shell: true,
  cwd: resolve(here, '..'),
});

child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
