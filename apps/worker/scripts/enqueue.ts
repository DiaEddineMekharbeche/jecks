import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUE_NAMES } from '../src/lib/queues.js';

/**
 * Enqueue a job by hand — the operator's escape hatch from the runbook.
 *
 *   pnpm --filter @jecks/worker exec tsx scripts/enqueue.ts reports daily-stats '{"days":7}'
 *   pnpm --filter @jecks/worker exec tsx scripts/enqueue.ts scheduling low-stock-alerts
 */
const [queueName, jobName, rawPayload] = process.argv.slice(2);

const valid = Object.values(QUEUE_NAMES) as string[];

if (!queueName || !jobName) {
  process.stderr.write(
    `Usage: enqueue.ts <queue> <job> [json]\nQueues: ${valid.join(', ')}\n`,
  );
  process.exit(1);
}

if (!valid.includes(queueName)) {
  process.stderr.write(`Unknown queue "${queueName}". Queues: ${valid.join(', ')}\n`);
  process.exit(1);
}

let payload: unknown = {};
if (rawPayload) {
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    process.stderr.write(`Payload is not valid JSON: ${rawPayload}\n`);
    process.exit(1);
  }
}

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const queue = new Queue(queueName, { connection });

const job = await queue.add(jobName, payload);
process.stdout.write(`queued ${queueName}:${jobName} as job ${job.id}\n`);

await queue.close();
await connection.quit();

// BullMQ keeps a blocking connection alive; without this the script never exits.
process.exit(0);
