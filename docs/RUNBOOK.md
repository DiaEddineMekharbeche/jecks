# Jeck's — Runbook

Everything an operator needs to run, back up and recover the platform. Written for
someone on call at 2 a.m., so every procedure is a command, not a description.

---

## 1. Local setup, from nothing

```bash
git clone <repo> jecks && cd jecks
cp .env.example .env          # then edit the secrets, see §2
pnpm install
pnpm docker:up                # postgres, redis, minio, mailpit
pnpm db:migrate               # creates the schema
pnpm db:seed                  # 58 wilayas, roles, 40 demo products, 75 days of orders
pnpm dev                      # api :4000, storefront :3000, admin :5174, worker
```

Sign in to the admin with the credentials the seed prints, by default
`owner@jecks.dz` / `Jecks2026!`. **Change this before the first deploy.**

| Service | URL |
|---|---|
| Storefront | http://localhost:3000 |
| Admin | http://localhost:5174 |
| API | http://localhost:4000/api/v1 |
| API docs | http://localhost:4000/docs |
| Mailpit | http://localhost:8025 |
| MinIO console | http://localhost:9001 |

### "Failed to fetch" in the admin, or the delivery estimator says every wilaya is
### undeliverable

The browser resolved `localhost` to `::1` and the API was only listening on IPv4. The
request is refused before it leaves the machine, so the browser reports a network
failure with no server log to match it.

Check both families:

```bash
curl -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4000/api/v1/health
curl -o /dev/null -w "%{http_code}\n" -g "http://[::1]:4000/api/v1/health"
```

Both must return 200. The API binds dual-stack by default; if one fails, something set
`API_HOST` to a single-family address. Unset it.

The admin also goes through the Vite dev proxy rather than calling the API
cross-origin — `VITE_API_URL=/api/v1` in development. Setting it to an absolute URL
reintroduces the cross-origin hop and, with it, this failure mode.

### Ports already in use

The compose file reads its ports from `.env`. If 5432, 6379, 9000 or 1025 are taken,
change `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_PORT`, `MAILPIT_SMTP_PORT` and keep
`DATABASE_URL`, `REDIS_URL` and `S3_ENDPOINT` in step.

### Windows: `prisma generate` fails with EPERM

The API and worker hold the query engine DLL open. Stop them, then regenerate:

```bash
pnpm docker:down            # not required, but stops background reconnects
# stop `pnpm dev`
pnpm db:generate
```

---

## 2. Secrets that must change before production

| Variable | Why |
|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Forging either one is a full account takeover. 32+ random bytes each. |
| `CREDENTIALS_KEY` | Encrypts courier and payment credentials at rest. 32 bytes, base64. |
| `POSTGRES_PASSWORD` | |
| `MINIO_ROOT_PASSWORD` / `S3_SECRET_KEY` | |
| `SEED_OWNER_PASSWORD` | Or delete the seeded owner and invite a real one. |
| `INTERNAL_API_TOKEN` | Presented by the worker on internal routes and by Prometheus on `/metrics`. Unset, those routes return 404 rather than opening. |
| `REVALIDATE_TOKEN` | Lets the API clear the storefront's cached pages after an admin write. Compose passes it to both containers. Unset, publishing still works but a change reaches the shop only when its cache expires, up to five minutes. |

Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

Rotating `JWT_ACCESS_SECRET` signs every live session out. That is the correct response
to a suspected leak. Rotating `CREDENTIALS_KEY` requires re-entering every courier and
payment credential, because the old ciphertext is unreadable.

---

## 3. Deploy to the VPS

Target is a single machine running Docker Compose behind Nginx with Let's Encrypt
(PRD Section 10.10).

```bash
ssh jecks@<host>
cd /srv/jecks
git pull
./infra/deploy.sh
```

The script does the whole sequence and refuses to start if any of it is not safe:

1. **Checks the environment.** Missing variables, or JWT secrets still set to the example
   values, stop the deploy before anything changes.
2. **Takes a database backup** into `backups/pre-deploy-<timestamp>.dump`. Before the
   migration, never after.
3. **Builds the images**, recording the previous tags so a rollback has somewhere to go.
4. **Runs `prisma migrate deploy`** in its own container. A failure here stops the
   deploy with the old containers still serving traffic.
5. **Restarts the services** and waits for `/health/ready` to answer. If it never does,
   the script prints the API log and tells you how to roll back.

```bash
./infra/deploy.sh --no-build    # restart with the images already built
./infra/deploy.sh --rollback    # back to the previous image tag
```

A migration that has to be undone needs a new forward migration. Do not hand-edit
`_prisma_migrations`.

### First deploy on a clean machine

```bash
git clone <repo> /srv/jecks && cd /srv/jecks
cp .env.example .env && nano .env        # see §2; generate real secrets
./infra/deploy.sh
docker compose -f infra/docker/docker-compose.prod.yml run --rm api pnpm db:seed
```

The seed is safe to run once on a new database and prints the owner sign-in. Change that
password immediately.

---

## 4. Backups

### The nightly job

The worker runs `pg_dump` at **02:30 Africa/Algiers**, every night, without anyone asking
it to. The dump is custom-format, uploaded to storage under `backups/`, and copies older
than **14 days** are deleted once the new one has landed — never before, so a failed
backup never takes the previous one with it.

Admin › Réglages › Sauvegardes lists the runs with their size and a download link, and
has a button to take one now. That is the screen to check after a bad night; a missing
row means the worker was not running.

The dump is written to a temporary file and then uploaded, rather than streamed. A
truncated upload that still gets stored looks fine in the list until the day somebody
needs it.

Media is not in the dump. It lives in object storage and is covered by the bucket's own
versioning; if the local storage driver is in use, back up `./storage` alongside it.

```bash
# Take one by hand, without the app:
docker exec jecks-postgres pg_dump -U jecks -Fc jecks > /srv/backups/jecks-$(date +%F).dump
```

### Restore drill

Do this **once before going live** and then quarterly. A backup nobody has restored is a
file, not a backup.

```bash
# 1. Fetch last night's dump from storage (or use a local copy).
#    The admin backup list gives a signed link, valid fifteen minutes.
curl -o /tmp/restore.dump "<signed link>"

# 2. Stop the writers.
docker compose -f infra/docker/docker-compose.prod.yml stop api worker

# 3. Restore beside the live database, never over it.
docker exec -i jecks-postgres createdb -U jecks jecks_restore
docker exec -i jecks-postgres pg_restore -U jecks -d jecks_restore < /tmp/restore.dump

# 4. Check it is the database you think it is.
docker exec jecks-postgres psql -U jecks -d jecks_restore -c   "select (select count(*) from orders) as orders,
          (select count(*) from customers) as customers,
          (select max(created_at) from orders) as newest_order;"

# 5. Only when those numbers look right, swap.
docker exec jecks-postgres psql -U jecks -d postgres -c "alter database jecks rename to jecks_old;"
docker exec jecks-postgres psql -U jecks -d postgres -c "alter database jecks_restore rename to jecks;"
docker compose -f infra/docker/docker-compose.prod.yml start api worker
```

Keep `jecks_old` for a week before dropping it.

For a drill rather than a real restore, stop after step 4 and
`dropdb -U jecks jecks_restore`. Write down the date you did it; the point of the drill
is knowing the commands work on **this** machine, with **this** Postgres version.

---

## 5. Health and monitoring

| Check | Command | Healthy |
|---|---|---|
| API liveness | `curl -sf localhost:4000/api/v1/health` | `{"data":{"status":"ok"}}` |
| API readiness | `curl -sf localhost:4000/api/v1/health/ready` | `database.ok` is true |
| Postgres | `docker exec jecks-postgres pg_isready -U jecks` | `accepting connections` |
| Redis | `docker exec jecks-redis redis-cli ping` | `PONG` |
| Worker | `docker compose logs --tail 20 worker` | a recent `job done` line |

Readiness failing while liveness passes means the database is unreachable: check the
Postgres container before restarting the API.

### Metrics

```bash
curl -sf -H "x-internal-token: $INTERNAL_API_TOKEN" localhost:4000/api/v1/metrics
```

Prometheus exposition format. Point a Prometheus at it and alert on these four, which are
the ones worth waking somebody for:

| Metric | Alert when | Why |
|---|---|---|
| `jecks_up` | absent for 2 min | The API is down. |
| `jecks_orders_unshipped_over_24h` | > 20 | Orders are being taken and not dispatched. |
| `jecks_cache_enabled` | 0 for 10 min | Redis is gone: the site works but is slow, and the queues are not running. |
| `jecks_http_requests_total{status="5xx"}` | rate rising | Something is broken that the logs will name. |

The endpoint is guarded by `INTERNAL_API_TOKEN` rather than by a session, because
Prometheus has no user and the numbers say how much the shop sells.

### Queues

Admin › Réglages › Files d’attente shows every queue’s depth and the most recent
failures, with a retry button.
It reads the same Redis keys BullMQ writes, so it is the same truth a dashboard would
show, behind the permission everything else uses.

A queue with a growing `waiting` count and no `active` jobs means the worker is not
running. A growing `failed` count means it is running and something is wrong; the
failure reason is on that screen.

### Errors

Set `SENTRY_DSN` to send server errors to Sentry. Unset, they go to the log with a
correlation id, which is also in the `x-correlation-id` header of the failing response —
so a customer quoting one is enough to find the request.

---

## 6. Common incidents

### Orders are coming in but no SMS goes out

In order: check that an SMS provider is selected and credentialed in Admin › Réglages ›
Notifications. With none selected the log adapter is used, which writes the message to
the worker log and reports success — correct for development, silent in production.

```sql
SELECT channel, status, error, count(*)
FROM notifications
WHERE "createdAt" > now() - interval '2 hours'
GROUP BY 1, 2, 3 ORDER BY 4 DESC;
```

`failed` rows carry the gateway's own message in `error`; `pending` rows that never
move mean the worker is not draining the queue, which is the next section.

### The dashboard shows yesterday's numbers

`daily_stats` is rebuilt nightly at 00:20 Africa/Algiers. Force it:

```bash
docker compose exec worker node -e "
  require('bullmq'); // enqueue reports:daily-stats with { days: 7 }
"
```

Or from the repo: `pnpm --filter @jecks/worker exec tsx scripts/enqueue.ts reports daily-stats '{"days":7}'`.

### A queue is backing up

Admin › Réglages › Files d’attente shows every queue’s depth and the most recent
failures with their reason, and retries a job without a shell. Use it first.

```bash
docker exec jecks-redis redis-cli LLEN bull:notifications:wait
docker compose -f infra/docker/docker-compose.prod.yml restart worker
```

Jobs are retried three times with exponential backoff and then land in the failed set,
where they are kept for seven days. Nothing is lost by restarting the worker.

Waiting jobs climbing with none active means the worker is down. Failures climbing means
it is up and something downstream is not — the reason on that screen names it.

### Stock looks wrong

`stock_movements` is an append-only ledger with `balanceAfter` on every row. Compare it
against `inventory_levels`:

```sql
SELECT v.sku, il."onHand",
       (SELECT sm."balanceAfter" FROM stock_movements sm
        WHERE sm."variantId" = v.id ORDER BY sm."createdAt" DESC LIMIT 1) AS ledger
FROM variants v
JOIN inventory_levels il ON il."variantId" = v.id
WHERE il."onHand" <> (SELECT sm."balanceAfter" FROM stock_movements sm
                      WHERE sm."variantId" = v.id ORDER BY sm."createdAt" DESC LIMIT 1);
```

A discrepancy means something wrote `inventory_levels` without a movement. Correct it
with a stock adjustment in the admin, never with a direct `UPDATE`.

### Someone is hammering checkout

Rate limits are in `ThrottlerModule` (120/min baseline, 10/min sign-in, 5/min OTP) and
in the settings `orders.max_per_phone_per_day` and `orders.duplicate_window_minutes`.
Blacklist a phone from the customer record; the flag is checked at order creation.

---

## 7. Database maintenance

```bash
# Slowest queries
docker exec jecks-postgres psql -U jecks -d jecks -c \
  "SELECT calls, round(mean_exec_time::numeric,1) ms, query FROM pg_stat_statements
   ORDER BY mean_exec_time DESC LIMIT 10;"

# Table sizes
docker exec jecks-postgres psql -U jecks -d jecks -c \
  "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables
   ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;"
```

`analytics_events` grows fastest. It is safe to prune beyond the reporting window:

```sql
DELETE FROM analytics_events WHERE "occurredAt" < now() - interval '180 days';
```

---

## 8. Known gaps

The platform is complete against PRD v1. What is deliberately not in it:

- **No alerting is configured.** `/metrics` is exposed and the right gauges are there,
  but nothing pages anybody until a Prometheus and an Alertmanager are pointed at it.
- **No WAF.** Rate limits are per-process; a distributed flood needs something in front.
- **Backups are not encrypted** beyond whatever the storage provider does. The dump holds
  every customer's phone number and address — turn on bucket encryption if they go to S3.
- **Courier adapters other than Maystro are polled, not pushed.** Status changes arrive
  within twenty minutes rather than instantly.
- **Commune coordinates are not in the bundled dataset**, so run optimisation falls back
  to the wilaya centroid. Good enough to order a city route, not a street-level one.

See `docs/SECURITY.md` for the security posture and the pre-launch checklist.
