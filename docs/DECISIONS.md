# Jeck's — Architecture Decision Record

Every choice the PRD left open, plus the reasoning. Format: one row per decision, detail below
when the trade-off matters. Update this file whenever a decision changes; never silently deviate.

| # | Topic | Decision | PRD reference |
|---|---|---|---|
| D01 | Monorepo tooling | pnpm workspaces + Turborepo 2 | 10.1 |
| D02 | Storefront framework | Next.js 14 (App Router, RSC) | 10.2 |
| D03 | Admin framework | Vite 5 + React 18 SPA, React Router 6 | 10.2 |
| D04 | API framework | NestJS 10 modular monolith (Express adapter) | 10.3 |
| D05 | ORM | Prisma 6 | 8, 10.5 |
| D06 | Primary keys | UUID v7 via Prisma `@default(uuid(7))` | 8 |
| D07 | Money | `BigInt` minor units (centimes) + `currency` char(3) | 8 |
| D08 | Translated fields | JSONB `{fr,ar,en}` with fallback chain fr → en → ar | 6.4 |
| D09 | Category tree | Adjacency list + materialized `path` string | 8 |
| D10 | Queue | BullMQ on Redis 7 | 10.3 |
| D11 | Object storage | `StorageProvider` interface, local disk in dev, MinIO/S3 in prod | 6.3 |
| D12 | Realtime | Server-Sent Events for admin event stream | 10.3 |
| D13 | Validation | Zod schemas in `@jecks/shared`, shared by API and both frontends | 9.2 |
| D14 | Test runner | Vitest everywhere (API included, via SWC) | 10.6 |
| D15 | Auth tokens | JWT access 15 min + rotating refresh in httpOnly cookie | 10.3 |
| D16 | Password hashing | Argon2id | 10.8 |
| D17 | Search | Postgres `tsvector` + `pg_trgm` behind a `SearchProvider` interface | 6.2 |
| D18 | Node runtime | Node 20 LTS (`engines: >=20`) | 10.1 |
| D19 | Currency | DZD only in v1; schema is multi-currency ready | 3 |
| D20 | Stock deduction moment | At `CONFIRMED`, configurable via settings | 7 |
| D21 | Workspace package builds | `shared` and `db` ship dual ESM/CJS via tsup; `ui` ships source | 10.1 |
| D22 | Storefront i18n | `[locale]` route segment plus middleware, no i18n library | 6.4 |
| D23 | Fonts | `next/font` self-hosting, bridged onto the design tokens | 9.1 |
| D24 | Hero 3D asset | Procedural geometry until a real GLB is uploaded | 9.1 |
| D25 | Denormalized rollups | Price range, stock, rating and sales cached on `products` | 10.7 |
| D26 | Search columns | Trigger-maintained `search_vector` and `search_text`, no expression indexes | 6.2 |
| D27 | Admin list state | Lives in the URL; `useServerTable` is the only reader and writer | Completion 2.2 |
| D28 | Admin components | Radix primitives, brand-tokened, in `@jecks/ui` | 9.2 |
| D29 | Export | `exceljs` streaming, same endpoint as the list via `?format=` | 5 |
| D30 | Audit | Global interceptor on mutating `/admin` routes, opt-out decorator | F-AD-93 |

---

## D02 — Next.js 14 for the storefront, not Vite

Section 10.2 makes SEO a MUST for the storefront and offers Next.js App Router or a
pre-rendered Vite SPA. Next.js is chosen because JSON-LD, `hreflang`, sitemap generation,
`next/image` and streaming SSR are first-party there, and Section 10.7 sets an LCP budget
that server rendering makes reachable.

Next.js **14**, not 15, because Section 0/Stack fixes React 18 and Next 15 requires React 19.
Revisit when the stack line is relaxed.

## D04 — NestJS over Fastify + tRPC

Section 10.3 prefers NestJS. Its module system maps one-to-one onto the admin modules of
Section 5, guards give the RBAC permission strings of 10.3 for free, and the Swagger plugin
satisfies the `/docs` requirement. tRPC would not serve the courier and payment webhooks,
which must be plain REST.

The Express adapter is used rather than Fastify: the throughput difference is irrelevant at
1k orders/day (Section 11) and Express has wider middleware support for the file upload and
raw-body webhook paths.

## D06 — UUID v7 identifiers

Section 8 allows UUID v7 or ULID. Prisma 6 generates v7 natively with `@default(uuid(7))`,
so ids are time-sortable (good B-tree locality on `created_at`-ordered lists) without an
extra dependency or a database extension.

Human-facing identifiers are separate: order numbers use the format `JK-{YYMMDD}-{SEQ}`
from a Postgres sequence, configurable in settings per F-AD-91.

## D07 — Money as BigInt centimes

All money columns are `BigInt` holding DZD centimes. No floating point anywhere in the
pricing path. `@jecks/shared/money` owns every conversion, rounding rule (half-up) and
formatter. The `currency` column exists on all monetary aggregates so the multi-currency
requirement in Section 1.2 does not need a migration later.

## D09 — Category tree as adjacency list plus path

Section 8 suggests `ltree` or a closure table. An adjacency list (`parent_id`) with a
denormalized `path` column (`/caps/truckers/`) covers the two real queries — render the
tree, and fetch a subtree — without the `ltree` extension, and keeps the tree editable from
Prisma without raw SQL. Depth is bounded to 4 levels in validation.

## D12 — SSE instead of Socket.IO

Section 10.3 allows either. Admin realtime is one-directional (server pushes new orders and
status changes). SSE needs no extra protocol, survives Nginx buffering with one config line,
and reconnects natively. If bidirectional needs appear (driver location streaming), swap the
transport behind `RealtimeService`.

## D14 — Vitest across the whole monorepo

One runner, one config style, one coverage reporter. Section 10.6 requires ≥ 90 % coverage on
the promo engine, pricing, order state machine, stock movements and P&L; those live in
`@jecks/shared` and the API's domain services and are unit-tested without a database.
Integration tests run against a disposable Postgres via Testcontainers.

## D17 — Postgres search first

`pg_trgm` + `unaccent` + weighted `tsvector` meets F-ST-25 for a 10k-product catalog
(Section 11). It is hidden behind `SearchProvider` so Meilisearch can be dropped in without
touching callers, per Section 6.2.

## D20 — Stock deduction at CONFIRMED

Section 7 makes the moment configurable and COD orders in Algeria have a meaningful
cancellation rate before the confirmation call. Reserving at `PENDING` and deducting at
`CONFIRMED` avoids overselling without writing off stock for orders that never get confirmed.
The setting key is `orders.stock_deduction_moment` with values `pending | confirmed | shipped`.

## D21 — Only `shared` and `db` are compiled

`@jecks/shared` and `@jecks/db` are consumed by NestJS, which compiles to CommonJS, and
by two bundlers that want ESM. tsup emits both (`.cjs` and `.js`) with a conditional
`exports` map, so each consumer resolves the flavour it can load. Both packages are
`"type": "module"`, which is what makes the `.js` output parse as ESM.

`@jecks/ui` ships TypeScript source instead, listed in `transpilePackages` for Next and
compiled directly by Vite. A component library gains nothing from being pre-built here,
and shipping source keeps Tailwind able to see the class names.

The one rule this imposes: **imports inside `@jecks/ui` carry no file extension.**
A `.js` specifier pointing at a `.tsx` file is a TypeScript convention that webpack does
not implement.

## D22 — i18n without a library

Section 6.4 names `i18next`, but the storefront's needs are a locale segment in the URL,
a JSON dictionary, a fallback chain and RTL. All four are a few dozen lines
(`middleware.ts`, `lib/dictionary.ts`, `t()` in `@jecks/shared`), and doing it directly
avoids shipping a runtime that duplicates what React Server Components already do.

The dictionary holds **plain strings only**. Counts and names are `{placeholders}` filled
by `fill()`. A function cannot cross the server-to-client boundary, and a dictionary that
contains one crashes the render.

The admin keeps its French copy inline; Section 3 allows Arabic admin copy to wait.

## D23 — next/font, bridged onto the tokens

`next/font/google` self-hosts Bebas Neue, Inter and Cairo at build time, so there is no
render-blocking request to Google and the fallback metrics are matched. The generated CSS
variables are mapped onto `--jk-font-*` on the `<html>` element, so `tokens.css` stays the
only place a font is named.

## D24 — The 3D hero is procedural for now

Section 9.1 wants a real 3D cap. There is no photographed GLB yet, so the hero builds one
from three.js primitives: a clipped sphere crown, an extruded curved brim, a brass button
and patch. Swapping in `useGLTF(url)` when an asset is uploaded changes one component and
nothing else.

Two constraints are already enforced, and must stay enforced when the real model lands:
`prefers-reduced-motion` stops all animation, and the three.js chunk is not requested
until the hero intersects the viewport. Without the second, three.js costs 230 kB on
first paint and the Lighthouse target in Section 1.3 is unreachable.

## D25 — Rollups on `products`

`minPrice`, `maxPrice`, `maxCompareAt`, `totalStock`, `ratingAverage`, `ratingCount` and
`salesCount` are denormalized onto `products`. A collection grid sorting by price or
filtering by availability would otherwise join variants and inventory levels on every
request, and Section 10.7 budgets p95 under 200 ms for catalog reads.

The cost is that these columns have owners: the price range follows variant writes and
the price scheduler, stock follows the movement ledger, ratings follow review moderation.
Anything that writes the underlying table refreshes the rollup in the same transaction.

## D26 — Search lives in columns, not in expressions

Migration `20260909120500` created a GENERATED tsvector column and GIN indexes over
expressions like `("name" ->> 'fr')`. Prisma's schema language can express neither, so
its differ proposed dropping them on every `migrate dev`. The schema and the migrations
could never agree, and the CI drift check would have had to be switched off.

Migration `20260909164000` replaces both with plain columns — `products.search_vector`
and `products.search_text`, `collections.search_text` — kept current by triggers that
fire only when their inputs change. Prisma declares the columns and owns their indexes;
only the function and the trigger stay outside its model, which its differ ignores.

Search itself is now two steps rather than one `OR`. The stemmed `tsvector` match runs
first and is indexed. Only when it returns nothing does a trigram pass run, using
`word_similarity` against the folded text: comparing the term to the closest *word*
rather than to the whole string is what stops a typo's score being diluted by the rest
of a product name. The practical difference is large — "trukker" went from finding two
truckers to finding all seven.

## D27 — Admin list state belongs in the URL

Page, page size, sort, search and every filter are query parameters, read and written
only by `useServerTable`. That makes a filtered list shareable, bookmarkable and
reload-proof, and it makes saved views a matter of storing and restoring a query string
rather than a bespoke state tree per module.

Row selection and table density stay in React state: they are about the current glance,
not about which rows exist.

## D28 — Radix, not a component framework

`@jecks/ui` builds on Radix primitives and the design tokens. Focus trapping, escape
handling, scroll locking, typeahead and ARIA wiring are solved problems that are easy to
get subtly wrong, and a component framework would bring a second design language into a
codebase that already has one.

The one rule this imposes: components that use hooks or context carry `'use client'`,
and class recipes live in `lib/variants.ts` with no directive, so a React Server
Component on the storefront can style a plain `<a>` with `buttonVariants(...)` without
pulling a client component into its tree.

## D29 — One endpoint serves the list and its export

`?format=csv|xlsx` on the same route, with the same filters, sort and permission check.
A separate export endpoint drifts: the file stops matching what the operator was looking
at. Both formats stream, so a large export starts downloading immediately rather than
being assembled in memory.

The CSV carries a UTF-8 byte-order mark. Without it Excel on Windows reads the file as
Latin-1 and mangles every accent and every Arabic character, which for this catalogue
means most of it.

## D30 — Auditing is global, not per-route

`AuditInterceptor` logs every successful mutating request under `/admin`, so a new module
is audited the moment it exists rather than when someone remembers a decorator. Reads are
ignored: logging every list request would bury the changes that matter. `@NoAudit()` opts
out the handful of routes that are personal preference rather than business change, such
as saving a list view.

Payloads are redacted by key before they are written — passwords, tokens, TOTP codes,
encrypted credentials — and long strings and large arrays are truncated.

## Deferred / not yet decided

- Online payment provider (Chargily vs SATIM direct). The `PaymentProvider` interface exists;
  only the COD provider is implemented in v1 (Section 3).
- Courier adapters beyond the manual/CSV one are scaffolds. Credentials shape is per provider
  and lands when API access is obtained (F-AD-61).
- Meilisearch, WhatsApp Cloud API, Sentry — interfaces in place, adapters unimplemented.
