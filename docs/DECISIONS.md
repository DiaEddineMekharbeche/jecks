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

## D51 — The promo engine is pure, and the database side is a separate service (M3.1)

`applyPromotions(context, rules)` takes everything it needs as arguments: the cart
lines, the customer's usage counts, the wilaya, the codes typed and the current time.
It reads nothing and writes nothing.

That is what makes sixty table-driven cases the whole truth about the discount surface.
The alternative — an engine that queries as it decides — can only be tested against a
database, which means it is tested rarely and argued about often.

Three invariants inside it are worth stating because everything else follows from them:

- Percentages apply to a **line total**, never to a unit price that is then multiplied.
  The second form loses a centime per unit and the cart stops adding up.
- Every grant is clamped against what the line still has left. Two stacked promotions
  cannot take a line below zero, so a cart can never become a refund.
- Priority decides, and the first non-stackable rule closes the door. Everything after
  it is rejected with `NOT_STACKABLE` rather than silently ignored.

## D52 — Discounts are allocated per line, always (M3.1)

Even an order-level fixed amount is spread across the covered lines in proportion to
their value, with the rounding remainder given to the largest line so the allocation
sums back exactly.

A discount parked on the order as a whole cannot be unwound when one line is returned.
Per-line allocation is what lets a return give back exactly the share that belonged to
the returned item, and what makes per-product margin exact in the P&L.

## D53 — The cart revalidates on every read (M2)

`GET /cart` re-checks prices, stock and promotion validity before answering, trims or
drops lines that no longer stand, and reports what it changed in `notices`.

A cart that quietly holds a sold-out line produces a checkout that fails at the last
step, which is where a shopper abandons. Correcting it in the drawer, with a sentence
saying why, costs one honest moment instead.

The price snapshot on the line is deliberately *not* overwritten: the shopper is told
the price moved and charged the current one at checkout, which is the honest order of
events rather than a silent substitution.

## D54 — The cart token is httpOnly, and the cart id never leaves the server (M2)

The browser holds an opaque 32-byte token in an httpOnly cookie. Nothing on the page can
read it, so a script injected into the storefront cannot lift a cart, and a guessed
cart id is not a way into someone else's basket.

## D55 — The storefront's access token is a cookie; the admin's stays in memory (M2)

`/auth/otp/verify` sets `jk_access` alongside the refresh cookie. A Next.js Server
Component render has no JavaScript context to hold a token in, and a token held in
browser JavaScript is one cross-site scripting bug away from being stolen.

The admin is a single-page app that *can* hold a token in memory, so it continues to use
the Authorization header and ignores the cookie. One guard reads both.

## D56 — Consent gates the third-party pixels, not the shop's own analytics (M2)

Google, Meta and TikTok tags are not on the page until the shopper accepts. The banner
is the switch, not a notice above trackers that are already running.

First-party analytics continue either way: they carry no identifier beyond a random
per-tab string, they never leave the shop's own database, and they are what the owner's
funnel and zero-result reports read. Declining costs the shopper nothing and costs the
owner no insight into their own shop.

## D57 — The service worker never caches HTML or the API (M2)

Static build output is cached forever (its name changes when its content does) and
images are cached with a sixty-entry cap. Documents go to the network and fall back to
an offline page only when the network is genuinely unreachable.

A cached price, a cached stock badge or a cached cart is a wrong answer delivered with
total confidence. On a shop, slow beats wrong.

## D58 — Account deletion scrubs rather than cascades (M2)

Deleting an account clears the contact details, deletes the addresses and wishlist,
revokes every session, and rewrites the phone so the unique index frees up and the same
number can shop again as a new customer.

The orders stay. They are accounting records the shop is required to keep, and a cascade
would take the shop's own books with them.

## D59 — The order state machine is a pure function of its context (M3.3)

`effectsOf({ from, to, deductionMoment, stockReserved, stockDeducted, … })` returns what
should happen; a service applies it inside one transaction. The machine reads nothing
and writes nothing.

That is what makes "every legal and illegal edge" a table of fifty-two cases rather than
a conversation, and it is why the stock effects can be reasoned about without opening a
database. It throws on an illegal move rather than returning a null effect: a caller who
forgot to check would otherwise write the new status with no side effects at all, which
is worse than either outcome on its own.

## D60 — Reserved and deducted are two different states, and an order is in one (M3.3)

`Order.stockReserved` means units are held against availability. `Order.stockDeducted`
means they have physically left the shelf. Deducting always releases the reservation
that covered it.

Without both flags a cancellation cannot tell a release from a restock: it would either
leak the held units forever or invent stock that was never taken. One boolean cannot
express the difference, and inferring it from the status breaks the moment the shop
changes `orders.stock_deduction_moment`.

## D61 — A short COD payment is not PAID (M3.3)

A driver handed less than the total leaves the order `PARTIALLY_REFUNDED` rather than
`PAID`. It is a slightly odd use of the enum, but the alternative is worse: marking it
paid hides the shortfall from the cash reconciliation, which is the one report that
exists to find exactly that.

## D62 — Risk flags an order for a human; only the blacklist refuses one (M3.2)

The score weighs failed deliveries against attempts (two out of thirty is a bad week,
two out of two is a habit), duplicates, orders per phone per day, orders per IP per
hour, order size against the shop's average, phone verification and address specificity.

Nothing above blocks. A shared IP in a student residence, a customer with two bad
deliveries, a genuinely large first order — all are real customers, and refusing them
costs more than the courier trip the check was meant to save. A captcha is asked for
only on the patterns a script produces, never on a customer's own history.

## D63 — Idempotency is enforced twice, and the database half is authoritative (M3.2)

A Redis `SET NX` lock stops two simultaneous requests; the unique `Order.idempotencyKey`
column stops a replay hours later. When Redis is unreachable the guard lets the request
through and logs it.

That is deliberate. The column already prevents the duplicate order, and refusing every
checkout because a cache is down would turn a degraded dependency into an outage.

## D64 — Order numbers are allocated under an advisory lock (M3.2)

`pg_advisory_xact_lock` on the day, then read the last number and add one, all inside the
order's transaction.

Reading the maximum without the lock means two checkouts in the same millisecond both
read it, and the second fails on the unique index — turning the shop's busiest minute
into its only lost sales. The lock is per day, so it never serialises more than the
handful of orders arriving in the same instant.

## D65 — Notifications are deduplicated by key, not by hope (M3.4)

Every message has a `dedupeKey` of event, channel, recipient and subject id, with a
unique index behind it. A queue retry after a partial failure updates that row rather
than sending again.

A queue that retries without this sends a customer two "your order shipped" messages,
and the second one teaches them to distrust the first. Test sends skip the key, because
a second sign-in code for the same phone is a new message rather than a retry.

## D66 — Every notifier ships working, including the default (M3.4)

`LogNotifier` writes the message it would have sent and reports success, and it is what
an unconfigured shop uses. SMTP is spoken directly rather than through a mail library;
the Algerian SMS gateways are covered by one configurable HTTP adapter rather than one
class per provider, because they have no common API beyond "a URL that takes a phone and
a message".

Two details cost more integrations than anything else, so both are handled and tested:
most Algerian gateways want `0…` rather than `+213…`, and one character outside GSM
03.38 drops a message from 160 characters to 70 and doubles its price.

## D67 — Cash on delivery is a real provider, not a null object (M3.2)

`CodProvider` implements the same interface as Chargily, is always configured, and is
the fallback whenever another provider is missing or misconfigured.

A shopper whose chosen gateway stopped working between loading the page and pressing the
button should end up with a cash-on-delivery order, not an error. In Algeria that is not
a degraded outcome; it is what the overwhelming majority of orders are anyway.

## D68 — The promotion simulator calls the engine, it does not imitate it (M3.1)

`POST /admin/promotions/simulate` assembles a cart from variant ids and runs
`applyPromotions`, the same pure function checkout runs. The admin screen renders the
answer and computes nothing itself.

A simulator with its own arithmetic drifts from the checkout within a release or two,
and the first person to notice is a customer being charged something the owner was
shown would not happen. The endpoint is marked `@NoAudit` because it writes nothing.

## D69 — A promotion's state is derived from the clock, not stored (M3.1)

`draft`, `scheduled`, `active`, `expired` and `exhausted` are computed from the dates,
the active switch and the usage against the limit, on every read.

A stored status needs a job to keep it true, and the day that job fails a finished sale
keeps selling. Deriving it costs one comparison and cannot go stale.

## D70 — Seeded discounts are granted by real promotions (M3.1)

The demo orders no longer carry an invented discount. A quarter of them apply a seeded
code, larger carts reach the automatic tier, and free shipping comes from the promotion
that offers it. Each grant writes a `PromoUsage` row.

The promotions list exists to answer "what has this cost us", and a discount with no
promotion behind it makes that column read zero on a shop full of discounted orders.

## D71 — The manual courier is the default, and it is real (M4)

`ManualCourier` creates a shipment with no tracking number, reports nothing rather than
guessing progress, and takes its updates from a pasted spreadsheet. It is what an
unconfigured shop uses.

Most Algerian shops drop parcels at a counter, get a handwritten receipt and type the
numbers back in that evening. Treating that as the fallback rather than as an absence
means the same code path serves them and a shop with an API key.

## D72 — The API integrates with couriers; the worker owns the clock (M4)

`courier.sync` in the worker calls one internal endpoint, and `CourierSyncService` in
the API does the polling. The endpoint is guarded by `INTERNAL_API_TOKEN`, and when that
is unset it refuses everything.

The adapters and the encrypted credentials live beside the database. Moving them into
the worker would mean two copies of every status mapping and two places to rotate a key;
calling the API over HTTP costs one request every twenty minutes.

## D73 — Labels and manifests are written by hand, not by a library (M4)

`PdfDocument` is three hundred lines that emit PDF 1.4 with the base-14 fonts and draw a
real Code 128 barcode with its checksum. The Code 128 table is transcribed from the
specification because there is no formula behind it.

The platform needs text, lines, boxes and a barcode on two page sizes. Every library
that does that also does forms, encryption, images and font subsetting, and can break at
install time. This is the same call D66 made about speaking ESMTP directly.

## D74 — A route is ordered by nearest neighbour and then untangled (M4)

`optimiseRoute` takes the greedy nearest-neighbour order and improves it with 2-opt until
no reversal helps. Both are pure functions over coordinates, covered to 100 %.

An exact travelling-salesman answer is not worth its cost for twenty stops, and greedy
alone regularly ends with one long leg back across the city. Stops with no coordinates
keep their given order and are appended rather than dropped: a stop we cannot place is
still a parcel somebody ordered.

Commune centroids are not in the bundled dataset, so a stop falls back to its wilaya
centroid. That is a poor address and a perfectly good ordering hint: it puts Tamanrasset
after Blida, which is the decision the route actually needs.

## D75 — Webhooks verify before they parse, in one module (M4)

Nest is started with `rawBody: true`, and every webhook computes its HMAC over the bytes
as they arrived. A body that has been through `JSON.parse` and back is a different
string, so signing the re-serialised form would make verification pass or fail on
whitespace rather than on authenticity.

They live in one module because the rule is the same for all of them, and because the
courier callbacks made the payment callback M3 documented but never routed impossible to
overlook any longer.

## D76 — Cash keeps three numbers apart (M4)

Expected, collected and reconciled are stored and displayed separately rather than
collapsed into a balance.

They answer different questions. Collected under expected is a conversation with a
driver about a delivery. Reconciled under collected is just cash that has not reached
the office yet. A single figure would hide the first inside the second, which is exactly
the loss a cash-on-delivery shop cannot afford to miss.

## D77 — One definition of profit, in the shared package (M5)

`computePnl` lives in `@jecks/shared` rather than in the API, because the API serves the
report and the worker writes the nightly `daily_stats` row. They were computing gross
profit differently: the worker took delivery and refunds off it, the report did not.

The rule is now: gross profit is goods less their cost. Delivery is a margin of its own,
payment fees are their own line, and refunds come off the net. Whichever process asks,
the answer is the same one.

## D78 — Revenue is delivered, not placed (M5)

The P&L, every sales report and the dashboard count an order when it reaches a doorstep,
on the day it got there.

A cash-on-delivery order is a request until the customer takes the parcel. Counting it at
checkout makes a shop with a 60 % delivery rate look twice as profitable as it is, and
that is the single easiest way for this platform to lie to its owner.
`finance.revenue_basis` can switch to "paid" for a shop that trades mostly online, and
every answer states the basis it used.

## D79 — Discounts are shown, not subtracted twice (M5)

Revenue is what was actually charged, which already has the discount taken off. The
discount line in the P&L exists so an owner can see what was given away; subtracting it
again would double-count it.

This is tested explicitly, because it is the mistake that produces a P&L reading worse
than reality and nobody notices for a quarter.

## D80 — Period costs are allocated by revenue (M5)

Rent does not belong to a wilaya, but a P&L grouped by wilaya that ignores rent flatters
every row. Expenses and ad spend are spread across groups in proportion to revenue, and
the remainder from the division goes to the largest group so the parts always add back to
the whole.

## D81 — Loyalty points are earned at the door (M5)

Accrual happens on the DELIVERED transition and is reversed on RETURNED or REFUNDED,
floored at zero. The ledger row carries the balance it produced, so a disputed balance can
be walked back rather than argued about.

Awarding at checkout would hand points to every customer who refuses a parcel, and points
are money. Reversal is capped at zero because a customer who already spent them cannot owe
them back.

## D82 — Merging admits the identity was wrong (M5)

The phone number is the customer identity (PRD Section 3), so the same person ordering
from two numbers produces two half-histories. Merge moves everything to the survivor and
archives the other rather than deleting it.

A blacklisted record refuses to merge into a clean one. Allowing it would launder exactly
the history the blacklist exists to keep, and the preview endpoint exists so nobody
discovers the size of the operation afterwards.

## D83 — Scheduled content filters on read (M6)

Home sections, banners and announcements carry `startsAt` and `endsAt`, and the
storefront applies the window on every read rather than a job flipping a flag.

A banner for a sale that ended at midnight has to be gone at midnight. A job that does
that is a job that can fail, and the failure is invisible until a customer screenshots
an expired offer. The admin still shows an out-of-window item, greyed: an owner needs to
see the promotion they scheduled for next week.

## D84 — Renaming a published page writes its redirect (M6)

Changing a published page's slug creates a 301 from the old address in the same
transaction.

A shop that renames `/livraison` to `/expedition` has broken every link to it — from
Instagram bios, from WhatsApp messages, from Google — and will not find out for months.
Asking somebody to remember the redirect afterwards is asking them to remember something
they have no reason to think about.

## D85 — The shop owns the newsletter list (M6)

Subscribers live in `newsletter_subscribers`; a provider receives a copy. Unsubscribes
are pushed out with everybody else rather than being filtered from the sync.

Filtering them would be the obvious optimisation and exactly wrong: the provider has to
be told somebody left, or the next campaign reaches a person who asked not to be mailed.
`log` is the default provider and writes what it would have sent, so a shop that mails by
hand still has a working button.

## D86 — Affiliate commission counts delivered orders (M6)

Attribution is the promotion code an affiliate hands out, and revenue is counted only on
orders that reached a doorstep.

An influencer whose audience orders enthusiastically and refuses at the door has not sold
anything. Paying commission on placed orders is how a cash-on-delivery shop ends up
paying for its own return shipping.

## D87 — Only the catalogue is cached, and invalidation is coarse (M7)

Six catalogue reads sit behind Redis with short lifetimes. A successful write to an admin
route drops the whole namespace rather than the keys it touched: editing one product
clears every catalogue key.

Precise invalidation is where caches go wrong. A product appears in a grid, a collection,
a facet count and three search results, and the day somebody adds a fourth place is the
day a stale price is shown to a customer. Being crude costs one repopulation after an
edit, which nobody notices, and removes the whole class of bug.

Nothing behind authentication is cached and no response containing a customer is, so
there is no cache key that can leak one shopper's data to another. With Redis
unreachable, every read falls through to the database: the site is slower, not broken.

## D88 — Metrics, Sentry and the PDF writer are written here, not installed (M7)

`/metrics` renders the Prometheus text format from a Map. The Sentry adapter posts a JSON
event to the store endpoint. Both are a few dozen lines.

`prom-client` and `@sentry/node` are each a dependency tree, a version to keep current
and an upgrade that can break a boot, in exchange for code whose entire job is to format
text this codebase already has. The same reasoning produced the raw-ESMTP mailer and the
PDF writer. The line is drawn at anything with real algorithmic content — Argon2, Sharp
and Prisma are dependencies, and should be.

The cost is honest: a Sentry API change would break the adapter silently, which is why a
failed capture logs a warning and never affects the response.

## D89 — Counters are keyed by route template (M7)

`GET /orders/:id` is one series, not one per order.

Keying on the literal path turns a metric into an unbounded set of series that fills
Prometheus's memory in a week and makes the numbers useless in the meantime. Nest exposes
the matched route, so the template is available without guessing at it.

## D90 — CSRF is a double-submit token on exactly two routes (M7)

`auth/refresh` and `auth/logout` require a `jk_csrf` cookie echoed in `x-csrf-token`.
Every other route is exempt.

Those two are the only ones a cookie alone authenticates; everything else needs a bearer
token, which a cross-origin page cannot read or attach. Applying the check everywhere
would add a header to every request in the admin and every webhook from a courier, to
protect against something already impossible. A request carrying a bearer token is
skipped explicitly, because the sender is not a browser and has no cookie to forge.

CORS is the first lock. This is the second, for the day an origin is added carelessly.

## D91 — Documents leave through a signed link, not a public URL (M7)

Labels, manifests, backups and exports are fetched through an authenticated admin route.
The exception is `/documents/:token`, where the token is a storage key and an expiry
signed with `CREDENTIALS_KEY`, valid fifteen minutes.

A label has to reach a courier over WhatsApp, and a link that requires signing in to the
admin does not survive that journey. The alternatives are worse: a public bucket exposes
every label ever printed to anyone who can guess a filename, and emailing the PDF puts
customer addresses in a third party's mailbox.

The token is restricted to five storage prefixes and refuses any key containing `..`, so
a forged one cannot walk out of them even if the signature were somehow produced.

## D92 — The queue screen replaces Bull Board (M7)

Admin › Réglages › Files d'attente reads BullMQ's Redis keys directly and shows depths,
recent failures and a retry button.

Bull Board is an Express application mounted inside the API, with its own auth story, its
own asset pipeline and its own idea of who is allowed in. What an operator actually needs
from it is four numbers per queue and the reason the last job died. Reading the keys
BullMQ documents gives the same truth behind the same permission as every other screen,
with nothing extra to secure.

The retry moves a job id from the failed sorted set back to the waiting list. That is
what a retry is; the payload never left Redis.

## D93 — The deploy script refuses before it acts (M7)

`infra/deploy.sh` checks the environment, dumps the database, builds, migrates, restarts
and then waits for `/health/ready` before reporting success.

Each check exists because the failure is silent otherwise: example JWT secrets ship and
nobody notices until a token is forged; a migration half-applies and the backup was taken
afterwards; the API crash-loops against a schema it cannot read while the script prints a
green tick. Verifying at the end is the difference between a deploy and a hope.

Rollback goes back to the previous image tag, recorded before the build. A migration that
must be undone needs a new forward migration, because `_prisma_migrations` is not a thing
to hand-edit at two in the morning.

## D94 — Marketing is its own section, behind its own permission (M7)

The newsletter, abandoned carts and affiliates moved out of Contenu to `/marketing`,
guarded by `marketing.read` rather than `content.read`. The old addresses redirect.

`marketing.read` had existed in the permission catalogue since M0 and was granted to the
marketing role, but nothing checked it: every marketing endpoint asked for `content.read`
instead. A permission that grants nothing is worse than no permission, because the
matrix screen shows it being granted.

The split is also the right shape. Content is what the shop says about itself; marketing
is who it says it to. A shop can reasonably let somebody run campaigns without letting
them rewrite the home page, and could not express that while the two shared a permission.

## D95 — A report has two export paths, and the long one is a job (M7)

Adding `format` to a report streams the file back on the request. `POST` to its
`exports` endpoint queues a job instead: the row appears at once, the worker runs it, and
the file lands in storage with a link.

The streamed path is right for what is on the screen and wrong for a year of order lines.
The browser holds a connection open for as long as the query takes, an Nginx in front
gives up at thirty seconds by default, and the accountant discovers this at the end of
the minute rather than the beginning. Raising the timeout moves the failure without
removing it.

The split follows the one courier polling established: the worker owns the queue slot,
the retry and the timeout; the API owns the query, because the report lives beside the
database and a second implementation in the worker would eventually give a different
number. The worker passes only a job id — the parameters are already in the row, and
sending them through Redis as well would be two copies that can disagree.

The queued path requires `reports.export` rather than `reports.read`. An unbounded export
is a copy of the shop's numbers leaving the shop, and the job records who asked for it.

## D96 — The packing slip carries no prices (M7)

The invoice shows the totals, the balance due at the door and the shop's RC, NIF and
tax article. The packing slip shows the items, the quantities and the order note, and
nothing about money.

They are printed for two different people. The packer needs to know what goes in the
box; the figures are noise that slows them down. And the slip travels inside the parcel,
where the customer's neighbour signing for it can read it — a shop that prints the price
there eventually has a conversation it did not want.

The note goes on the slip rather than the invoice for the same reason: "call before
coming up, the bell does not work" is an instruction for the person carrying the box.

## D97 — The integration suite starts its own databases (M7)

`pnpm test:integration` runs the API against a Postgres and a Redis that Testcontainers
starts for the run, applies the real migrations, and seeds only the reference data.
`INTEGRATION_DATABASE_URL` points it at an existing instance while iterating.

Containers rather than the Postgres that CI already provides as a service, because the
suite should run the same way on a laptop as in CI. A test that only passes against a
database somebody remembered to reset is not a test, and one that only passes in CI
cannot be debugged where it fails.

It is a separate config and a separate script. Keeping it out of `pnpm test` means the
fast suite stays fast and still runs on a machine with no Docker daemon, which is what a
pre-commit hook and a quick loop need.

Two things this found on its first run, both invisible to every unit test because a unit
test calls the service and never passes the guard:

- **`orders.cancel` and `orders.refund` were never checked.** Both had been in the
  permission catalogue since M0 and granted to roles. Anyone with `orders.transition` —
  a warehouse hand marking boxes packed — could cancel a customer's order. The target of
  the transition now decides, because a route-level guard cannot say "this status, not
  that one". The third permission found granting nothing, after `marketing.read` and
  `reports.export`.
- **`TRUNCATE ... CASCADE` reached backwards into the fixtures.** `users` carries an
  avatar pointing at `media`, so truncating media deleted the staff accounts the suite
  had signed in as, and the next write failed on a foreign key that looked like an
  application bug. The keep list is now closed over its own references before anything
  is truncated.

## D98 — What the integration layer found (M7)

Covering the admin controllers at the integration layer turned up four defects, none of
which any unit test could have seen, because a unit test calls the service and never
passes through the guard, the pipe or the database.

- **The cash drawer was readable by an order agent.** Admin › Livraison › Caisse and
  Règlements were hidden behind `delivery.settle`, and the routes behind them asked only
  for `delivery.read` — which every dispatcher and agent holds so they can see where a
  parcel is. The day's cash position per driver was one URL away from anybody who could
  look up a shipment. This is the exact failure acceptance criterion 6 is about: hiding
  a menu entry is not access control.
- **Creating a category used the partial update schema.** A create with no name passed
  validation and failed in the service with a message about a database column. Create
  and patch are separate schemas now.
- **Adjusting stock for a variant that does not exist returned 500.** The service posted
  straight to the ledger, Postgres refused the foreign key, and an operator who pasted a
  stale id was told the server had broken. It now refuses with a 404 and writes nothing.
- **One route disagreed with the documented error contract.** Settings are validated in
  the service rather than by the pipe, because the schema depends on the scope in the
  path, and it returned 400 for `VALIDATION_FAILED` where `docs/API.md` documents 422.

The pattern behind the first one is worth naming, because it has now happened four
times: a permission exists in the catalogue, the screen respects it, and the API does
not. `marketing.read`, `reports.export`, `orders.cancel` and `orders.refund` all granted
nothing until something checked them. The contract test in
`apps/api/src/modules/admin-contract.int-spec.ts` enumerates the routes the application
actually registered and proves every one refuses an anonymous caller; it does not yet
prove each one demands the right permission, which is the obvious next step.

## D99 — Two maps drawn from coordinates, not from tiles (M7)

The plan asked for a choropleth of the wilayas from a bundled GeoJSON, and a Leaflet map
over OpenStreetMap on the runs board. Neither is what shipped.

**The wilaya map is a proportional-symbol map.** There is no wilaya boundary set in the
repository, and an approximation of a country's internal borders drawn from memory would
be worse than no map at all — it would look authoritative and be wrong. The chef-lieu
coordinates are real, already in the database, and already what the delivery routing
measures distance from, so a disc is placed at each one. Area carries the volume and
colour carries the delivery success rate, because "where do we sell" and "where do
parcels come back" are two different questions and the second is the expensive one.

Area rather than radius, so a wilaya with twice the orders looks twice the size rather
than four times.

**The run map is a sketch, not a street map.** A tile layer needs the network, and a
dispatcher planning tomorrow's rounds on a bad connection gets a grey rectangle. The
deciding reason is different though: the coordinates behind a stop are often the wilaya's
chef-lieu rather than the customer's street, because the bundled dataset has no commune
centroids (D74). Plotting coarse points on a street map claims a precision that is not
there. The sketch answers what a planner actually asks — does the order of the stops make
sense, or does it cross the city twice — and says on its face that the distances are as
the crow flies.

Both fit their own extent rather than a fixed frame, so a round inside one commune and a
round across three wilayas each fill the drawing.

## D100 — The home preview is an iframe of the real storefront (M6)

Admin › Contenu › Page d'accueil embeds the storefront rather than re-rendering the
blocks inside the admin. A second renderer is a second set of bugs, and the one that
matters is the one the customer loads.

It shows what is **published**. The plan asked for a signed `?preview=token` that would
let the builder see a scheduled block before its start date; that needs the storefront to
accept the token and bypass the window filter (D83), and is not built. The panel says so
in as many words, because letting somebody believe they are previewing a draft is worse
than not offering the preview.
