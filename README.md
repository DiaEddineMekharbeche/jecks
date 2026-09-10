# Jeck's

Online store and back-office for a caps and headwear brand, built for the Algerian
market: cash on delivery, wilaya-based shipping, phone-first checkout, French, Arabic
and English.

Specification: [`docs/PRD.md`](docs/PRD.md). Decisions the PRD left open:
[`docs/DECISIONS.md`](docs/DECISIONS.md). API contract: [`docs/API.md`](docs/API.md).
Operations: [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

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
| `pnpm db:migrate` / `db:seed` / `db:studio` / `db:reset` | Database |
| `pnpm --filter @jecks/ui storybook` | Design system on :6006 |
| `pnpm docker:up` / `docker:down` / `docker:logs` | Local services |

## Status

**M0 (Foundation)**, **M1.0 (admin framework)**, **M1.1 (media pipeline)**,
**M1.2 (catalog admin)** and **M1.3 (inventory and purchasing)** are complete. See
[`docs/PRD-COMPLETION.md`](docs/PRD-COMPLETION.md) for the milestone plan.

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

Not built yet: settings, users and audit screens (M1.4), cart and checkout, order management, delivery operations, finance reporting and
marketing tools (M2 to M6 in PRD Section 13). **Do not point a live domain at this yet.**
