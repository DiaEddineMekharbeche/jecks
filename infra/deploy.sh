#!/usr/bin/env bash
#
# Deploys Jeck's to a single VPS — PRD Section 10.4.
#
# One machine running Postgres, Redis, MinIO, the API, the worker, the storefront, the
# admin and Nginx, which is what an Algerian shop actually rents. Everything here is
# ordinary docker compose; there is no orchestrator to learn and nothing to un-learn if
# the shop outgrows it.
#
#   ./infra/deploy.sh              pull, build, migrate, restart, verify
#   ./infra/deploy.sh --no-build   restart with the images already present
#   ./infra/deploy.sh --rollback   go back to the previous image tag
#
# It is safe to run twice. It refuses to run at all if the environment is not complete,
# because a half-configured deploy that boots is worse than one that does not.

set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The production file is an overlay on the base file (see its header); passed alone,
# compose rejects it because the datastores it adjusts have no image.
readonly COMPOSE_BASE="${ROOT}/infra/docker/docker-compose.yml"
readonly COMPOSE="${ROOT}/infra/docker/docker-compose.prod.yml"
readonly ENV_FILE="${ROOT}/.env"
readonly STAMP="$(date +%Y%m%d-%H%M%S)"

BUILD=1
ROLLBACK=0

for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --rollback) ROLLBACK=1 ;;
    -h | --help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

log() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

trap 'fail "Deploy failed at line $LINENO. Nothing was rolled back automatically — read the output above."' ERR

# --- preflight ---------------------------------------------------------------
# Every check here has cost somebody an outage at some point.

log "Checking the environment"

command -v docker >/dev/null || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 is not available"
[[ -f "$ENV_FILE" ]] || fail ".env is missing. Copy .env.example and fill it in."

required=(
  DATABASE_URL
  REDIS_URL
  JWT_ACCESS_SECRET
  JWT_REFRESH_SECRET
  CREDENTIALS_KEY
  COOKIE_DOMAIN
  CORS_ORIGINS
)

missing=()
for key in "${required[@]}"; do
  grep -qE "^${key}=.+" "$ENV_FILE" || missing+=("$key")
done
[[ ${#missing[@]} -eq 0 ]] || fail "Missing from .env: ${missing[*]}"

# The example values are not secrets. Shipping them is the most common real mistake.
if grep -qE '^(JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)=change-me' "$ENV_FILE"; then
  fail "JWT secrets are still the example values. Generate real ones:
  openssl rand -base64 48"
fi

if ! grep -qE '^COOKIE_SECURE=true' "$ENV_FILE"; then
  echo "  ! COOKIE_SECURE is not true. Cookies will travel in clear."
fi

if ! grep -qE '^INTERNAL_API_TOKEN=.+' "$ENV_FILE"; then
  echo "  ! INTERNAL_API_TOKEN is unset: courier polling and the nightly jobs will not run."
fi

if ! grep -qE '^REVALIDATE_TOKEN=.+' "$ENV_FILE" || grep -qE '^REVALIDATE_TOKEN=change-me' "$ENV_FILE"; then
  echo "  ! REVALIDATE_TOKEN is unset or the example value: admin changes reach the shop only when its cache expires."
fi

# --- rollback ----------------------------------------------------------------

if [[ $ROLLBACK -eq 1 ]]; then
  log "Rolling back to the previous images"
  [[ -f "${ROOT}/.deploy-previous" ]] || fail "No previous deploy recorded."
  previous="$(cat "${ROOT}/.deploy-previous")"

  IMAGE_TAG="$previous" docker compose -f "$COMPOSE_BASE" -f "$COMPOSE" --env-file "$ENV_FILE" up -d
  log "Rolled back to $previous"
  exit 0
fi

# --- backup ------------------------------------------------------------------
# Before a migration, never after. A migration that half-applies is the case this is for.

log "Taking a database backup"
mkdir -p "${ROOT}/backups"

if docker compose -f "$COMPOSE_BASE" -f "$COMPOSE" --env-file "$ENV_FILE" ps postgres --status running >/dev/null 2>&1; then
  docker compose -f "$COMPOSE_BASE" -f "$COMPOSE" --env-file "$ENV_FILE" exec -T postgres \
    pg_dump --format=custom --no-owner -U jecks jecks \
    > "${ROOT}/backups/pre-deploy-${STAMP}.dump" \
    || fail "Backup failed. Deploy stopped; nothing has changed."

  echo "  Saved backups/pre-deploy-${STAMP}.dump"
else
  echo "  Postgres is not running yet; this looks like a first deploy."
fi

# --- build -------------------------------------------------------------------

if [[ $BUILD -eq 1 ]]; then
  log "Building images"
  # Recorded before the build so a rollback has somewhere to go.
  docker compose -f "$COMPOSE_BASE" -f "$COMPOSE" --env-file "$ENV_FILE" images --quiet > "${ROOT}/.deploy-previous" 2>/dev/null || true

  docker compose -f "$COMPOSE_BASE" -f "$COMPOSE" --env-file "$ENV_FILE" build --pull
fi

# --- migrate -----------------------------------------------------------------
# Migrations run before the new code starts, in their own container, so a failure stops
# the deploy rather than leaving the API crash-looping against a schema it cannot read.

log "Applying migrations"
docker compose -f "$COMPOSE_BASE" -f "$COMPOSE" --env-file "$ENV_FILE" up -d postgres redis
sleep 3

# Absolute paths: the image works from /app/apps/api, where neither exists relatively.
docker compose -f "$COMPOSE_BASE" -f "$COMPOSE" --env-file "$ENV_FILE" run --rm api \
  /app/node_modules/.bin/prisma migrate deploy --schema /app/packages/db/prisma/schema.prisma \
  || fail "Migrations failed. The old containers are still running; nothing was restarted."

# --- restart -----------------------------------------------------------------

log "Starting services"
docker compose -f "$COMPOSE_BASE" -f "$COMPOSE" --env-file "$ENV_FILE" up -d --remove-orphans

# --- verify ------------------------------------------------------------------
# A deploy that finishes without checking anything is a deploy that reports success on
# a site that is down.

log "Waiting for the API"

api_url="$(grep -E '^API_PUBLIC_URL=' "$ENV_FILE" | cut -d= -f2- || echo 'http://localhost:4000/api/v1')"
healthy=0

for attempt in $(seq 1 30); do
  if curl -fsS "${api_url}/health/ready" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done

[[ $healthy -eq 1 ]] || {
  echo
  docker compose -f "$COMPOSE_BASE" -f "$COMPOSE" --env-file "$ENV_FILE" logs --tail 50 api
  fail "The API did not become ready. Logs above. Roll back with: ./infra/deploy.sh --rollback"
}

log "Deployed"
docker compose -f "$COMPOSE_BASE" -f "$COMPOSE" --env-file "$ENV_FILE" ps

cat <<'NOTES'

Next:
  - Watch the logs for a minute:  docker compose -f infra/docker/docker-compose.prod.yml logs -f api worker
  - Place a test order and confirm it reaches the admin.
  - If something is wrong:        ./infra/deploy.sh --rollback

NOTES
