# Security

What this platform defends against, how, and where the gaps are. Written for whoever is
on call, not for a compliance folder.

Report a vulnerability to the shop owner directly. There is no bug bounty; there is one
person who reads the mail.

## The shape of the threat

This is an Algerian cash-on-delivery shop. The realistic attacks, in the order they
actually happen:

1. **Order flooding** — a competitor or a bored teenager places hundreds of fake orders.
   Each one costs a phone call and possibly a delivery run.
2. **Credential stuffing** against the admin, because one account has every permission.
3. **Forged courier webhooks** — marking orders delivered means marking them paid.
4. **Discount abuse** — one promotion code used a thousand times.
5. **Data theft**: the customer list is phone numbers and addresses, which have a market.

Card fraud is not on the list, because almost nothing is paid by card.

## Authentication

**Staff** sign in with email and password. Passwords are hashed with Argon2id
(`@node-rs/argon2`), never with a fast hash. Two-factor is available with TOTP and can be
required per user.

**Customers** sign in with a phone number and a six-digit code. There is no customer
password, because a password nobody remembers is a password reset flow nobody secures.

**Tokens.** A short-lived access token (15 minutes) lives in memory in the client and
travels as a bearer header. The refresh token (30 days) lives in an httpOnly cookie and
never reaches JavaScript. Logout clears both and revokes the session server-side.

**Failed sign-ins** are counted per account and lock it temporarily, so a stuffing run
gets a handful of tries rather than unlimited ones.

## Authorization

Permissions are strings, defined once in `packages/shared/src/enums/permissions.ts`, and
the same list drives the navigation, the route guards and the API. A section that is
hidden is also an unreachable URL — PRD acceptance criterion 6 — and the e2e suite
proves it by requesting the endpoint directly rather than by looking at the menu.

The surface is enforced, not trusted. `apps/api/permission-surface.txt` lists every
route and what it demands, generated from the code; a test fails if any route loses its
permission, demands one that does not exist, or if any permission in the catalogue ends
up controlling nothing. That last rule is the one that matters: six times a permission
has existed, been offered on the matrix screen, been respected by the menu, and been
asked for by no route at all.

Two checks that are easy to get wrong and are covered by tests:

- A driver reads their own run. Every `/driver` route resolves the driver from the
  session and never from a path parameter, so changing an id in the URL returns 403.
- An order agent cannot read the finances, from the screen or from the API.

## Cross-site request forgery

The API is normally driven by a bearer token, which a cross-origin page cannot read or
attach. The exception is the pair of routes a cookie alone authenticates — `auth/refresh`
and `auth/logout` — and those require a double-submit token: a script-readable cookie
that must be echoed back in `x-csrf-token`. Another origin can cause the cookie to be
sent but cannot read it.

CORS restricts credentialed requests to the configured origins. The CSRF check is the
second lock, for the day an origin is added carelessly.

## Webhooks

Every inbound webhook verifies a signature **over the raw body, before any field of it is
read**. Nest is started with `rawBody: true` so the bytes survive JSON parsing; signing a
re-serialised body would make verification pass or fail on whitespace rather than on
authenticity.

A webhook that cannot be verified gets a 401 and changes nothing. An unrecognised parcel
is accepted and ignored, because couriers retry forever on anything that is not a 2xx.

## Rate limits

| Route | Limit | Why |
|---|---|---|
| `POST /auth/login` | 10 / min | Credential stuffing |
| `POST /auth/otp/*` | 5 / min | Each one costs an SMS |
| `POST /orders` | 10 / min | Order flooding |
| `POST /webhooks/couriers/*` | 600 / min | A busy afternoon is hundreds of scans |
| `POST /webhooks/payments/*` | 120 / min | |
| everything else | 120 / min | |

Order flooding is also scored: orders per phone per day and per IP per hour raise the
risk score and can require a captcha. Only a blacklist refuses an order outright,
because refusing a real customer costs more than a wasted trip.

## Idempotency

`POST /orders` accepts an `Idempotency-Key`. A repeat returns the original order rather
than creating a second, enforced twice: a Redis lock for two simultaneous requests, and a
unique column for a replay hours later. If Redis is down the request proceeds, because
the column is what actually guarantees it.

## Secrets

Courier API keys, SMS gateway credentials and payment keys are encrypted at rest with
AES-256-GCM, keyed by `CREDENTIALS_KEY`. The stored form is `v1:<iv>:<tag>:<ciphertext>`;
the version prefix exists so a future key rotation can read both formats.

Secrets are **write-only through the API**. They go in encrypted and come back masked, and
sending the mask back means "leave this one alone" — so a form can round-trip without the
browser ever holding the real value.

`CREDENTIALS_KEY` itself is an environment variable. Losing it means re-entering every
integration's credentials; leaking it means rotating all of them.

## Documents

Labels, manifests, backups and exports are private. They are reachable in two ways:

- Through an authenticated admin route, which is how the admin fetches them.
- Through a short-lived signed link (`/documents/:token`), for the cases where a document
  has to leave the app — a label forwarded to a courier over WhatsApp. The token is the
  storage key and an expiry, signed with `CREDENTIALS_KEY`, valid for fifteen minutes,
  restricted to four storage prefixes, and refuses any key containing `..`.

Every document response is `Cache-Control: no-store` and
`Content-Disposition: attachment`, so a PDF is never rendered on the API's origin.

## Uploads

Media uploads are checked by declared type and size, stored under content-addressed keys,
and processed by the worker rather than in the request. An uploaded SVG is served with
`Content-Security-Policy: default-src 'none'`, so it cannot run script on the API origin.

## Headers and transport

Helmet is enabled. The content security policy is set at the edge (Nginx) rather than in
the application, because the storefront loads media from a different origin and the
policy has to know about the CDN.

TLS terminates at Nginx. `COOKIE_SECURE=true` in production means cookies never travel in
clear.

## Logging

Every request carries a correlation id, echoed in `x-correlation-id` and in every error
envelope, so a support message quoting one can be traced to a single request.

Errors never leak internals to the client: stack traces stay in the log, the body carries
a code and a sentence. Audit rows record who changed what, with a before and after.

What is deliberately **not** logged: passwords, tokens, decrypted credentials, and full
card data (which the platform never sees — Chargily handles it).

## OWASP Top 10, honestly

| Risk | Where we stand |
|---|---|
| A01 Broken access control | Permission strings shared between menu, guard and API; e2e tests request endpoints directly. Driver and agent isolation covered. |
| A02 Cryptographic failures | Argon2id for passwords, AES-256-GCM for credentials, HMAC-SHA256 for webhooks and document links. TLS at the edge. |
| A03 Injection | Prisma parameterises everything. The one raw query (the stock ledger's `SELECT … FOR UPDATE`) takes no user input. Zod validates every body and query. |
| A04 Insecure design | Order state machine is a closed graph; stock moves through one ledger; money is integer minor units end to end. |
| A05 Security misconfiguration | Env is validated at boot and the process refuses to start on a bad value. Internal routes are disabled when `INTERNAL_API_TOKEN` is unset rather than open. |
| A06 Vulnerable components | `pnpm audit` in CI. Dependencies are deliberately few: no mail library, no PDF library, no Sentry SDK, no metrics client. |
| A07 Authentication failures | Lockout after repeated failures, TOTP available, short access tokens, server-side session revocation. |
| A08 Software and data integrity | Lockfile committed, CI builds from it. Webhooks verified before parsing. |
| A09 Logging and monitoring | Correlation ids, audit log, `/metrics`, optional Sentry. **Gap: no alerting is configured by default** — see the runbook. |
| A10 Server-side request forgery | The API makes outbound requests only to courier, payment and newsletter endpoints whose hosts are hard-coded in their adapters, never to a URL from user input. |

## Known gaps

Stated plainly, because a security document that claims completeness is not one.

- **No automated dependency-update pipeline.** `pnpm audit` reports; a human acts.
- **No WAF.** Rate limits are per-process; a distributed flood needs something in front.
- **No alerting out of the box.** `/metrics` is exposed and the gauges are the right ones,
  but nothing pages anybody until a Prometheus and an Alertmanager are pointed at it.
- **Backups are not encrypted at rest** beyond whatever the storage provider does. The
  dump contains every customer's phone number and address. If backups go to S3, turn on
  bucket encryption.
- **The admin has no IP allowlist.** For a single-shop deployment that is usually right;
  for a shop with a fixed office it is a cheap improvement at the Nginx layer.

## Checklist before going live

- [ ] `CREDENTIALS_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` are freshly generated,
      not the values from `.env.example`.
- [ ] `COOKIE_SECURE=true` and `COOKIE_DOMAIN` matches the real domain.
- [ ] `CORS_ORIGINS` lists only the real storefront and admin origins.
- [ ] `INTERNAL_API_TOKEN` is set, or accept that courier polling and the nightly jobs
      do not run.
- [ ] The seeded owner password is changed.
- [ ] TLS is terminating at Nginx and HTTP redirects to it.
- [ ] A restore from backup has been done once, on purpose, before it is needed.
