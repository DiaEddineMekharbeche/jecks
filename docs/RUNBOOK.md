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
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.prod.yml pull
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.prod.yml up -d --no-deps api worker web
docker compose exec api node dist/main.js --migrate   # or: pnpm db:migrate:deploy
```

Migrations run before the new containers take traffic. `prisma migrate deploy` never
resets and never prompts, which is why the production script uses it and not
`migrate dev`.

**Roll back** to the previous image tag:

```bash
docker compose -f … up -d --no-deps api=jecks/api:<previous-tag>
```

A migration that has to be undone needs a new forward migration. Do not hand-edit
`_prisma_migrations`.

---

## 4. Backups

### Nightly dump

```bash
docker exec jecks-postgres pg_dump -U jecks -Fc jecks > /srv/backups/jecks-$(date +%F).dump
```

Keep 30 days. The dump is custom-format, so it restores selectively and compresses well.
Media lives in object storage and is backed up by the bucket's own versioning; if the
local driver is in use, back up `./storage` alongside the dump.

### Restore, tested quarterly

```bash
# 1. Stop writers
docker compose stop api worker

# 2. Restore into a scratch database first and check it
docker exec -i jecks-postgres createdb -U jecks jecks_restore
docker exec -i jecks-postgres pg_restore -U jecks -d jecks_restore < /srv/backups/jecks-2026-09-08.dump
docker exec jecks-postgres psql -U jecks -d jecks_restore -c "select count(*) from orders;"

# 3. Only when that looks right, swap it in
docker exec jecks-postgres psql -U jecks -d postgres -c "alter database jecks rename to jecks_old;"
docker exec jecks-postgres psql -U jecks -d postgres -c "alter database jecks_restore rename to jecks;"
docker compose start api worker
```

Restoring straight over the live database is how a bad backup becomes an outage. Always
restore beside it first.

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

---

## 6. Common incidents

### Orders are coming in but no SMS goes out

The notification adapter is log-only until M3. Confirm with
`docker compose logs worker | grep notification`. If an adapter is configured, check
`notifications` rows with `status = 'failed'` and the `error` column.

### The dashboard shows yesterday's numbers

`daily_stats` is rebuilt nightly at 00:20 Africa/Algiers. Force it:

```bash
docker compose exec worker node -e "
  require('bullmq'); // enqueue reports:daily-stats with { days: 7 }
"
```

Or from the repo: `pnpm --filter @jecks/worker exec tsx scripts/enqueue.ts reports daily-stats '{"days":7}'`.

### A queue is backing up

```bash
docker exec jecks-redis redis-cli LLEN bull:notifications:wait
docker compose restart worker
```

Jobs are retried three times with exponential backoff and then land in the failed set,
where they are kept for seven days. Nothing is lost by restarting the worker.

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

## 8. What is not built yet

M0 delivered the foundation. Checkout, order management, delivery operations, finance
reporting and the marketing tools arrive in M1–M6 (PRD Section 13). Before then:

- there is no way to place an order through the storefront;
- notification adapters log instead of sending;
- courier adapters other than manual/CSV are configuration rows without code.

Do not point a live domain at this until M7.
