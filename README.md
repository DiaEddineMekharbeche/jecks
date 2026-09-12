# Jeck's

Online store and back-office for a caps and headwear brand, built for the Algerian
market: cash on delivery, wilaya-based shipping, phone-first checkout, French, Arabic
and English.

Specification: [`docs/PRD.md`](docs/PRD.md). Decisions the PRD left open:
[`docs/DECISIONS.md`](docs/DECISIONS.md). API contract: [`docs/API.md`](docs/API.md).
Operations: [`docs/RUNBOOK.md`](docs/RUNBOOK.md). Security:
[`docs/SECURITY.md`](docs/SECURITY.md). What "done" means and where it is proven:
[`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md).

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm docker:up      # postgres, redis, minio, mailpit
pnpm db:migrate
pnpm db:seed        # 58 wilayas, roles, 40 demo caps, 75 days of trading
pnpm dev
```

| | |
|---|---|
| Storefront | http://localhost:3000 |
| Admin | http://localhost:5174 |
| API + docs | http://localhost:4000/api/v1 · /docs |
| Mailpit | http://localhost:8025 |

The seed prints the owner sign-in. If a port is taken, change it in `.env`; the compose
file and both apps read from there.

## Layout

```
apps/
  api/          NestJS. Modules mirror PRD Section 5.
  storefront/   Next.js 14 App Router, server-rendered, fr/ar/en with RTL.
  admin/        Vite SPA. Route access follows the same permissions the API enforces.
  worker/       BullMQ jobs: daily stats, price schedules, abandoned carts, alerts.
packages/
  db/           Prisma schema, migrations and seed. 108 tables.
  shared/       Zod schemas, enums, permission catalogue, money and phone utilities.
  ui/           Design tokens and primitives, with Storybook.
  storage/      StorageProvider: local disk and S3-compatible, used by api and worker.
  config/       tsconfig, ESLint and Tailwind presets.
infra/          Dockerfiles, compose files, Nginx.
```

Domain logic lives in the API. `packages/shared` holds the contracts both frontends and
the API validate against, so a rule cannot drift between them.

## Rules worth knowing before you edit

**Money is `BigInt` minor units.** Every amount in the database, the API and the UI is
an integer of centimes. `@jecks/shared/money` owns all arithmetic, rounding and
formatting. No float ever touches a price.

**Phone numbers are the customer identity.** They are normalized to E.164 on the way in
by `@jecks/shared/phone`. Store the canonical form, never what was typed.

**Translated text is JSONB.** `{ fr, ar, en }`, read through `t()` so a missing
translation falls back instead of rendering blank.

**Permissions are strings, defined once.** `packages/shared/src/enums/permissions.ts` is
the catalogue; the seed writes it into the database and the API guard reads it off route
metadata. Adding a permission means editing that file and re-seeding.

**Migrations are committed.** Change `schema.prisma`, run `pnpm db:migrate`, commit the
generated SQL. CI fails if the schema and the migrations disagree.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Every app in watch mode |
| `pnpm build` | Build everything |
| `pnpm lint` / `pnpm typecheck` | Across the workspace |
| `pnpm test` / `pnpm test:cov` | Unit tests, with coverage |
| `pnpm test:integration` | The API against a real Postgres and Redis; needs Docker |
| `pnpm db:migrate` / `db:seed` / `db:studio` / `db:reset` | Database |
| `pnpm --filter @jecks/ui storybook` | Design system on :6006 |
| `pnpm docker:up` / `docker:down` / `docker:logs` | Local services |
| `pnpm e2e` | Playwright against a running, seeded stack (`pnpm e2e:install` first) |
| `pnpm load` | k6 catalogue load test, 200 readers against a p95 of 200 ms |
| `./infra/deploy.sh` | Deploy to the VPS; `--rollback` undoes it |

## Status

**v1 complete.** M0 through M7 have shipped: the foundation, the admin framework, the
media pipeline, catalogue administration, inventory and purchasing, settings and roles,
the storefront, checkout and orders, delivery and cash, finance and customers, content
and marketing, and the hardening pass. Every module of PRD Section 5 has its screens and
every navigation entry leads somewhere.

Where each of the seven acceptance criteria is proven, and what is checked by hand rather
than by a test, is in [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md). The milestone plan is
[`docs/PRD-COMPLETION.md`](docs/PRD-COMPLETION.md).

M7 made it safe to point a domain at:

- **The catalogue is cached** in Redis with short lifetimes, and a write to an admin
  route drops the whole namespace rather than guessing which keys it touched. With Redis
  down the site is slower, not broken.
- **`/metrics`** in Prometheus format, guarded by the internal token, with the gauges
  worth an alert: unshipped orders older than a day, cache reachability, 5xx rate.
  Written by hand, like the mailer and the PDF writer, rather than adding a client.
- **A queue screen** replacing Bull Board: depths, the last failures with their reason,
  and a retry, behind the same permission as everything else.
- **CSRF** as a double-submit token on the two routes a cookie alone authenticates, and
  **signed document links** valid fifteen minutes for the label that has to reach a
  courier over WhatsApp.
- **An end-to-end suite** covering the seams a unit test cannot: guest checkout on a
  phone, an order walked to delivered and appearing in the P&L, an agent refused the
  finances by the API rather than by the menu.
- **A deploy script** that refuses on a bad environment, backs up before it migrates, and
  waits for readiness before claiming success.
- **Marketing became its own section** behind `marketing.read`, a permission the role
  matrix had been granting since M0 while nothing checked it. Queued report exports use
  `reports.export` for the same reason: it existed and meant nothing.

M6 gave the shop its own voice:

- **A home builder**: blocks in the order they are drawn, each with its own window, so
  a promotion scheduled for next week appears on its own and leaves on its own.
- **Banners, announcements, pages and menus**, all scheduled the same way. Renaming a
  published page writes the redirect for its old address.
- **A newsletter list the shop owns**, copied to Brevo when that is switched on.
  Unsubscribes travel with everyone else, so a campaign cannot reach somebody who left.
- **Abandoned carts** with a recovery message each cart receives once, and **affiliates**
  whose commission counts delivered orders rather than placed ones.

M5 made the shop legible to its owner:

- **A profit and loss** grouped nine ways and comparable to the period before. Revenue
  counts delivered orders, because a cash-on-delivery order is a request until somebody
  takes the parcel. The rule lives in one shared function the worker uses too.
- **Expenses** with recurring series generated forward, ad spend with real ROAS
  attributed by UTM source, and a signed ledger whose balances are never stored.
- **Seventeen named reports**, each returning its own columns so the screen renders one
  it has never seen.
- **Customers** with segments computed nightly, a reliability figure that decides whether
  the next order gets a phone call, and a merge that admits the phone number was wrong.
- **Loyalty** earned at the door and taken back if the parcel comes home.
- **A dashboard** that now answers where the orders are, when they arrive, and how many
  survive to a doorstep.

M4 took the parcel out of the warehouse:

- **Five couriers behind one interface**, each tested against a stubbed HTTP client on
  what actually breaks: whole dinars against centimes, wilaya name against wilaya code,
  and status vocabularies that share no words. The manual courier is the default and a
  real implementation, not a placeholder.
- **A rate matrix** over 58 wilayas and two delivery types, edited in bulk. A cell
  inherited from a zone shows as such; typing in it creates the exception.
- **Delivery runs** ordered by distance, printed as a manifest the driver signs, and
  closed stop by stop. A driver's phone sees their own round and nobody else's.
- **A cash drawer** that keeps expected, collected and reconciled apart, and courier
  settlements that never count a parcel twice.
- **Labels and manifests** rendered by a small PDF writer with a real Code 128 barcode,
  rather than by a dependency.
- **Webhooks** that verify against the raw body before reading a field, which also
  routed the payment callback M3 had documented.

M3 closed the loop from basket to doorstep:

- **Promotion management** with a condition builder that only shows the fields the
  chosen type uses, bulk unique codes with the ambiguous characters removed, and a
  simulator that runs the real engine on a hand-built cart. The list adds up what each
  promotion has actually given away, which is the only place that number exists.
- **Guest checkout** on one page, idempotent, re-pricing the cart from scratch and
  re-quoting the shipping before it asks for anything. Order lines snapshot the price
  and the cost, so an order stays readable and its margin exact after the catalogue
  moves on.
- **A risk score** that flags an order for a human rather than refusing it: failed
  deliveries weighed against attempts, duplicates, floods per phone and per address,
  order size against the shop's average. Only a blacklist blocks.
- **An order state machine** that is pure, covers the graph of PRD Section 7 exactly,
  and is the single door every status change goes through. Reserved and deducted are
  tracked separately, so a cancellation always knows whether to release or restock.
- **The order screen an agent lives in**: risk flags in sentences, tel: and WhatsApp
  links, call logging with callbacks, editable address before packing, notes, tags, and
  transition buttons the server decides.
- **Payments** behind one interface. Cash on delivery always works and is the fallback;
  Chargily is switched on in settings and its webhook is verified before it is read.
- **Notifications** with six real transports and a dedupe key, so a queue retry can
  never send the same SMS twice. The sign-in code now goes out the same way.

M2 turned the storefront from a catalogue into a shop:

- **A cart** that revalidates prices, stock and promo validity on every read, trims or
  drops what no longer stands, and says what it changed. The drawer computes nothing:
  every figure comes from the server.
- **A promotion engine** that is pure and covers percentage, fixed amount, free
  shipping, tiered, buy-X-get-Y and bundle price, with scoping, limits, stacking and
  refusal reasons written for the shopper.
- **Reviews** on the product page with a server-computed verified badge, plus wishlist,
  back-in-stock alerts, newsletter and a contact form.
- **An account area** entered by phone and a six-digit code, with orders and their
  timeline, addresses, wishlist, loyalty ledger, and a delete that scrubs the person
  while keeping the orders.
- **Public order tracking** by number and phone, which is how most COD shoppers ever
  check on a parcel.
- **A progressive web app**: installable, with a service worker that caches the build
  and product imagery but never HTML or the API.
- **Cookie consent that means something**: the third-party pixels are not on the page
  until the shopper accepts.

M1.4 finished the administration of the shop itself:

- **Settings** in fifteen sections, validated per scope rather than per key. Credentials
  are encrypted at rest and come back masked, so a form round-trips without the browser
  ever holding the real value.
- **Notification templates** as a grid of events by channels, edited in three languages,
  with a click-to-insert variable list, a preview and a real test send.
- **The team**: nobody is given a password. An invitation is a single-use link valid 72
  hours on which the colleague sets their own. Deactivating cuts every session at once,
  and the last owner account cannot be removed.
- **A permission matrix** where ticking a box saves immediately, so the answer to "can
  the order agent see the profit figures" is one screen away.
- **The journal**, written by a global interceptor rather than by each module, with a
  before-and-after diff per field.
- **Backups** taken by the worker as a custom-format pg_dump, nightly at 02:30 and on
  demand, pruned after fourteen days.

M1.3 made stock real:

- **Stock overview** by variant and location, with valuation at cost, low and out
  buckets, adjust and transfer, and CSV/Excel export.
- **A stock ledger** rather than an editable number: every change is a signed movement
  carrying its resulting balance, written under a row lock so two agents cannot both
  sell the last unit.
- **Suppliers and purchase orders** through draft, ordered, partially received and
  received. Receiving moves stock, spreads freight across the lines by value, and
  re-averages the weighted-average cost of each variant.
- **Stock counts** that freeze the expected quantity when the session opens, then post
  the difference against live stock when applied, so sales made during the count survive
  it.

M1.2 made the catalogue editable:

- **Products list** with status tabs, filters on category, collection, brand, tag, stock
  state and price, bulk edit, duplicate, archive, CSV/Excel export, and a CSV/XLSX
  import that reports every problem before it writes anything.
- **Product editor** over seven tabs: general, media, variants and pricing, stock,
  shipping, SEO, related. Margin per variant is live, publication can be scheduled, and
  a draft autosaves while a published product waits for an explicit save.
- **Variants** generated from option sets. Regenerating keeps the SKU, price, cost and
  stock of every combination that still applies, and never deletes one that has sold.
- **Categories** as a drag-and-drop tree. A move rewrites the materialized path of the
  node and everything under it in one transaction.
- **Collections**, manual or rule-based, with a rule builder whose preview runs the same
  translator the storefront runs, so what it promises is what shoppers get.
- **Merchandising**: pin, hide and boost per collection, plus search synonyms so
  "cap" and "kaskita" reach the casquettes.
- **Reviews** moderation with reply, where approving recomputes the product's rating in
  the same transaction.
- **Brands, tags, attributes and size guides**, each with its usage count so nothing is
  deleted out from under a product.

M1.1 added the media pipeline:

- **Uploads** typed by their bytes rather than by a claimed content type, stored under a
  content hash so traversal and duplicates are structurally impossible.
- **Processing** in the worker: three widths in WebP and AVIF within about a second,
  a dominant colour for the loading placeholder, Draco compression for 3D models.
- **Media library** with folders, usage counts, an unused filter, alt text in three
  languages, and a retry for anything that failed.
- **One storage driver** shared by the API and the worker, local disk or S3-compatible.

M1.0 added the pieces every later module builds on:

- **Design system.** Table, dialog, sheet, dropdown, tabs, select, combobox, multi-select,
  date range picker, switch, checkbox, radio, money input, toast, command palette,
  file dropzone, translated input, stat tile, status badge, timeline.
- **List framework.** `useServerTable` keeps page, sort, filters and search in the URL, so
  a filtered list is a shareable link. Saved views, column visibility, density, bulk
  selection and CSV/Excel export come with it.
- **Realtime.** Server-sent events with per-permission filtering, reconnect backoff, live
  nav badges and a connection indicator.
- **Command palette.** ⌘K across orders, products, customers and navigation.
- **Audit.** Every mutating admin request is logged with a redacted payload diff.
- **Search.** Full-text and fuzzy matching moved onto trigger-maintained columns, so the
  schema and the migrations agree with no hand-written expression indexes.

Earlier, M0 delivered:

- Prisma schema covering all of PRD Section 8, with migrations and a reproducible seed
- Staff sign-in with password and TOTP, phone OTP for customers, rotating refresh
  tokens, and RBAC enforced on every admin route
- Public catalog API: filtering, sorting, facets, smart collections, typo-tolerant
  Postgres search, shipping quotes for all 58 wilayas
- Storefront: home, collections with filters, product pages with a 3D hero, search,
  CMS pages, sitemap and JSON-LD, in three languages with RTL
- Admin: sign-in, permission-gated navigation, dashboard reading pre-aggregated stats
- Worker: daily statistics, scheduled prices, abandoned carts, low-stock alerts

Known gaps, stated plainly, are in [`docs/SECURITY.md`](docs/SECURITY.md) and at the end
of [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md): no alerting is configured out of the box,
there is no WAF, backups are not encrypted beyond the storage provider, and the
two-minute checkout and the Lighthouse budget are measured by hand.

Before a real domain, work through the checklist at the end of
[`docs/SECURITY.md`](docs/SECURITY.md) — generated secrets, `COOKIE_SECURE`, the seeded
owner password changed, and one restore from backup done on purpose.
