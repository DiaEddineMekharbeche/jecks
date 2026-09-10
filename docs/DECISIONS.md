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
| D31 | Storage driver | One `@jecks/storage` package shared by the API and the worker | 6.3 |
| D32 | Upload validation | Content sniffing, not the declared type or the extension | 10.8 |
| D33 | Renditions | sharp, 3 widths x WebP+AVIF, served via `<picture>` not next/image | 6.3 |
| D34 | GLB posters | Draco compression and embedded-texture posters; no headless renderer | 9.1 |
| D35 | Smart-collection rules | One translator shared by the storefront read and the admin preview | F-AD-11 |
| D36 | Merchandising | Pins, hides and boosts live on the membership row, created on demand for smart collections | F-AD-13 |
| D37 | Product autosave | Drafts autosave; an active product waits for an explicit save | Completion 2.2 |
| D38 | Product import | Synchronous, dry-run first, one row per variant keyed by SKU | F-AD-10 |
| D39 | Search synonyms | Query expansion in the database, ORed `tsquery` fragments | F-AD-13 |
| D40 | sharp version | One version across the workspace; two native copies cannot coexist | 6.3 |

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

## D31 — One storage driver, shared

The API's `StorageService` originally implemented S3 for URL building but not for reads
and writes, which fell through to local disk. With `STORAGE_DRIVER=s3` the API wrote to
the filesystem while the worker read from the bucket, so every upload processed into a
404 — a split brain that no unit test would have caught, because each side was correct
on its own.

`@jecks/storage` now holds the only implementation: a local driver and an S3-compatible
one over plain fetch with SigV4. The AWS SDK would add several megabytes to two container
images for four verbs; signing is about sixty lines.

The environment is read through one helper, `storageConfigFromEnv()`, which also resolves
a relative `LOCAL_STORAGE_DIR` against the workspace root rather than the current
directory. The API runs from `apps/api` and the worker from `apps/worker`, so resolving
against the process's own directory gave them two different media roots — the same bug in
a second guise.

A related trap, worth stating because it cost time: `import 'dotenv/config'` must be the
worker's first *import*, not a `loadEnv()` call in `main.ts`. Module imports are hoisted
and evaluated before any statement in the importing file, so the queue module read
`REDIS_URL` before dotenv had populated it and connected to the wrong Redis. The load now
lives in `lib/env.ts`, imported first.

## D32 — Uploads are typed by their bytes

`Content-Type` and the file extension are both attacker-controlled. `file-sniffer.ts`
reads the leading bytes and matches them against the closed set of formats the platform
accepts; anything else is refused before it reaches storage. The ambiguous containers get
a second check: RIFF is only WebP when the tag at offset 8 says so, and an ISO base media
file is AVIF or MP4 depending on its brand.

SVG has no magic number and can carry script. It is accepted, because staff use vector
logos, but it is never inlined and the media route serves it under a
`default-src 'none'` content security policy, so an uploaded SVG cannot execute on the
API's origin.

Storage paths are derived from the content hash, never from the filename, so traversal
and collisions are structurally impossible and the same file uploaded twice occupies the
disk once. The original name is kept only as a display label.

## D33 — Renditions are pre-generated, not proxied

The worker produces three widths (200, 600, 1600) in WebP and AVIF, and the storefront
serves them through a plain `<picture>` element with `srcset`. Routing them back through
`next/image` would re-encode work that is already done and add a hop to every request.

Two rules the pipeline enforces: never upscale, because a 300 px logo rendered at 1600 px
is bytes spent on blur; and AVIF at effort 4 rather than 9, which is roughly ten times
faster for a few percent of size — the right trade inside a queue.

Each image also stores its dominant colour, painted behind the picture while it loads. A
real BlurHash would look better but needs a decoder on both frontends; seven characters
buy most of the benefit.

## D34 — GLB posters come from the file, not from a renderer

Rendering a poster from geometry needs a GL context in Node — headless-gl or a browser —
which is a heavy native dependency for one thumbnail. The processor instead Draco-compresses
the model, compresses its textures, and uses the first embedded texture as the poster. When
a model carries none, the admin assigns one from the media library
(`PATCH /admin/media/:id` with `posterMediaId`).

This supersedes nothing in D24: the storefront hero still uses procedural geometry until a
real GLB is uploaded.

## D35 — One smart-collection rule translator

A smart collection is resolved to its rules on every read rather than materialized, so a
rule change is live immediately. That means two callers evaluate the same rules: the
storefront, answering a shopper, and the admin preview, answering "what would this rule
select?". Two implementations would drift, and the drift would be invisible — the preview
would keep promising matches the shop never shows.

`apps/api/src/modules/catalog/collection-rules.ts` is the single translator. It also
validates: a price rule whose value is not a whole number of centimes is refused at write
time rather than silently matching nothing, and a rule set with no rules matches nothing
rather than matching the whole catalogue.

The one rule that is coarser than it looks is `DISCOUNT`. The rollups carry the highest
compare-at price and the lowest selling price, not a discount percentage, so the rule reads
as "currently marked down" rather than "marked down by more than N %". Storing a percentage
would mean a fourth denormalized column with a fourth owner (D25); the coarse version covers
the "Dernière chance" collection the PRD actually asks for.

## D36 — Merchandising lives on the membership row

Pinning, hiding and boosting apply per collection, not per product: the same cap can lead
the summer grid and sit mid-page in the new arrivals. `collection_products` already joins
the two, so the three columns hang there.

A smart collection has no membership rows — its members come from rules. Rather than
introduce a second table, an override row is created on demand the first time an operator
touches a product in that collection. It carries no membership meaning: the rules still
decide who appears, and the row only decides where.

Boost is a nudge on the default sort rather than a fixed slot. A fixed slot freezes a
product at rank three for ever, including long after it stopped selling; a nudge lets it
keep moving with its own numbers.

## D37 — A draft autosaves, a published product does not

The product editor holds seven tabs of one entity and writes them with a single PATCH.
While the product is a draft it autosaves 1.5 s after the last keystroke: a draft is not on
the storefront, so saving early costs nothing and losing an afternoon of work costs a lot.

An active product does not autosave. It is what shoppers are looking at, and a half-typed
name or a partially updated price should reach them when someone decides it should, not
while they are still typing. That editor keeps a dirty-state guard instead, and an explicit
save button.

## D38 — Product import is synchronous and dry-run first

One row is one variant, keyed by SKU; rows sharing a slug become one product with several
variants, which is how a spreadsheet naturally describes "black S, black M, white S".

The import runs in the request rather than as a queued job, because the validation report
is only useful while the operator still has the file open. The ceiling is 5 000 rows, which
is comfortably inside a request and far beyond a season's catalogue.

It defaults to a dry run, and the commit button stays disabled until a run comes back with
no issues. Money is read in dinars and converted to centimes here, because that is what an
operator types; the alternative is discovering on the storefront that column F meant
centimes.

## D39 — Synonyms expand the query, not the index

A shopper types "cap", "kaskita" or "قبعة" and the catalogue says "casquette". The bridge is
a small table the shop maintains (F-AD-13), applied by expanding the query before it runs:
each term becomes a `plainto_tsquery`, and the fragments are ORed into one indexed lookup.
None of the operator's text is interpolated into the query language.

Expanding at query time rather than baking synonyms into `search_vector` means a new
synonym works immediately, with no reindex, and the typed term stays first in the list so an
exact match still outranks a synonym match. A pathological synonym list is capped at eight
terms so one search cannot become forty index scans.

## D40 — One sharp version across the workspace

`@gltf-transform/functions` pulls `ndarray-pixels`, which depends on `sharp`. When the
workspace pinned an older sharp than that, pnpm installed two copies, and the 3D pipeline
failed on the second native module to load: `ERR_DLOPEN_FAILED`. Two native sharp addons
cannot share a process.

The workspace therefore tracks the version the deepest dependency needs, so the tree
deduplicates to one copy. Bumping sharp now means checking what `ndarray-pixels` asks for,
not only what the image pipeline needs.

The model processor was hardened at the same time: texture compression is skipped when a
model has no textures and degrades to a warning when the encoder cannot read them, and a
Draco pass that makes a file larger — which happens on very simple meshes — keeps the
original instead.

## Deferred / not yet decided

- Online payment provider (Chargily vs SATIM direct). The `PaymentProvider` interface exists;
  only the COD provider is implemented in v1 (Section 3).
- Courier adapters beyond the manual/CSV one are scaffolds. Credentials shape is per provider
  and lands when API access is obtained (F-AD-61).
- Meilisearch, WhatsApp Cloud API, Sentry — interfaces in place, adapters unimplemented.

## D41 — Stock is a ledger, not a number (M1.3)

`inventory_levels` is a cache; `stock_movements` is the record. Nothing outside
`StockLedgerService` writes a level. Every change posts a signed movement carrying the
balance that resulted from it, inside a transaction that takes `SELECT … FOR UPDATE` on
the level row.

The lock is what makes two agents confirming the same last unit resolve rather than both
succeed. The balance column is what lets an operator answer "where did those four units
go" a month later without replaying the whole table.

Manual corrections are the one operation allowed to push stock negative, because a level
that already went negative through an oversell can only be fixed by an operation that
tolerates the state it is fixing.

## D42 — Weighted average, one cost per variant (M1.3)

`Variant.costPrice` is a single figure for the variant, not per location, and receiving
re-averages it against every unit held anywhere. Per-location costing would be more
precise and would make COGS depend on which warehouse happened to ship an order, which
is a distinction the shop cannot act on.

Order-level costs on a purchase order (freight, customs) are allocated across the
received lines in proportion to merchandise value, with the rounding remainder given to
the largest line so the allocations sum back exactly. Freight is charged once, on the
first receipt: a second partial delivery does not re-charge shipping the shop paid once.

## D43 — A stock count freezes its expectation but applies against live stock (M1.3)

Opening a session snapshots `expectedQuantity` per line. That is what the variance report
compares against, so a counter is not blamed for sales made while they were walking the
aisle.

Applying, however, computes the delta against the *current* level, not the frozen one.
Those sales are real and must survive the count. Lines left uncounted are skipped rather
than treated as zero — "we did not reach that shelf" and "that shelf is empty" are
different statements.

## D44 — Stock buckets are filtered after the page is read (M1.3)

`low`, `out` and `negative` depend on the product's `lowStockThreshold` and on
`onHand - reserved`, neither of which is a column that can be indexed usefully. The list
endpoint therefore applies the bucket filter to the page it just read.

The alternative — a generated column or a raw query per bucket — buys accuracy in the
total row count for a filter an operator uses to find a handful of problem rows, and puts
the definition of "low" in two places. One definition, in `stockState()`, shared by the
list and by the realtime low-stock event, is worth the imprecise count.

## D45 — Settings are validated per scope, not per key (M1.4)

`PATCH /admin/settings/:scope` takes a partial payload and checks it against one Zod
object per scope. A key that does not belong to the scope is refused rather than stored.

Per-key validation cannot express a rule that spans two settings, and silently accepting
an unknown key produces a row nothing ever reads — the kind of thing that is discovered
six months later when someone wonders why their change had no effect. A scope is also
the unit a screen section saves, which makes one audit row describe one intention.

## D46 — A saved secret is never sent back, and the mask means "unchanged" (M1.4)

Credentials (SMS gateway, Telegram bot, payment keys) are encrypted with
`CREDENTIALS_KEY` using AES-256-GCM and returned to the admin as `••••••••`.

Sending that mask back in a PATCH is defined to mean "leave this one alone". Without
that rule a settings form has to choose between re-sending the real secret to the
browser — where a screen recording or an extension can read it — and refusing to save
any other field on the same form. The mask makes the round-trip safe.

The authentication tag is what turns a tampered ciphertext into a thrown error rather
than into garbage that an HTTP client then sends to a third party. A decryption that
fails because the key was rotated returns null, so the integration reports "not
configured" instead of taking a request down.

## D47 — Nobody's password is chosen for them (M1.4)

There is no "create user with password" route. An owner invites an address; the store
keeps only a SHA-256 hash of a random token, valid 72 hours and single-use; the invitee
follows the link and sets their own password.

The alternative — a temporary password typed by the owner — is in practice sent over
WhatsApp and never changed, which is how a small team's admin access leaks. Re-inviting
the same address deletes the pending invitation first, so there is never a second live
link the recipient might not be the one to use.

## D48 — The last owner cannot be removed (M1.4)

Deactivating, deleting, or stripping the owner role from the only active owner is
refused with `LAST_OWNER`. Self-deactivation is refused separately.

A shop with no owner has nobody holding `users.write`, so nobody can create one: the
state is unrecoverable from inside the product. The check counts *other* active owners
rather than owners including the subject, which is the difference between a guard that
works and one that always passes.

## D49 — Backups run in the worker, in custom format, pruned by naming convention (M1.4)

`POST /admin/backups` writes a `Job` row and enqueues; it never runs `pg_dump` in the
request, because a dump of a real catalogue outlives any sensible HTTP timeout.

The dump is written to a temporary file and only then uploaded. Streaming straight to
storage would let a truncated dump be stored looking healthy, which is worse than a
failed backup: it looks fine in the list until the day someone needs it.

Retention deletes only files matching `jecks-<timestamp>.dump`. Anything else under the
prefix is left alone, so the retention job can never become a way to delete something a
person put there deliberately.

The connection string is split into `PGHOST`/`PGUSER`/`PGPASSWORD` rather than passed on
the command line, keeping the database password out of the process list.

## D50 — The permission matrix saves on tick (M1.4)

Each checkbox issues `PATCH /admin/roles/:id/permissions` with the role's full new set.

A matrix behind a Save button gets half-edited and abandoned, and the operator cannot
tell afterwards which state the server holds. Replacing the whole set rather than
diffing keeps the write idempotent; a role has tens of permissions, not thousands, so
the extra rows written are not worth a diff that can be wrong.
