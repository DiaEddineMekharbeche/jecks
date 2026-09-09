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

**M0 (Foundation)** and **M1.0 (admin framework)** are complete. See
[`docs/PRD-COMPLETION.md`](docs/PRD-COMPLETION.md) for the milestone plan.

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

Not built yet: cart and checkout, order management, delivery operations, finance
reporting, marketing tools. Those are M3 to M6 in PRD Section 13. **Do not point a live
domain at this yet.**
