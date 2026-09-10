# Jeck's API

REST, JSON, versioned at `/api/v1`. Interactive documentation is generated from the
code and served at `/docs` in every non-production environment.

## Conventions

**Envelope.** Every response is `{ data, meta?, error? }`.

```json
{ "data": { "id": "…" }, "meta": { "page": 1, "perPage": 24, "total": 40 } }
```

```json
{
  "data": null,
  "error": { "code": "VALIDATION_FAILED", "message": "Some fields need attention",
             "details": [{ "path": "phone", "message": "Enter a valid Algerian phone number" }] },
  "meta": { "correlationId": "epi2S05zWxVJ" }
}
```

**Money** is an integer of minor units, sent as a decimal string because JSON has no
bigint. `"350000"` is 3 500,00 DA. Never parse it as a float.

**Translated text** is an object: `{ "fr": "Trucker Atlas", "ar": "…", "en": "…" }`.
Clients resolve it with the fallback chain in `@jecks/shared/i18n`.

**Errors** carry a stable `code`. Match on the code, never on the message; messages are
end-user copy and will change.

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 422 | Zod rejected the payload; `details` lists the fields |
| `UNAUTHENTICATED` | 401 | No token, or the token expired |
| `TOKEN_INVALID` | 401 | Token present but not verifiable |
| `INVALID_CREDENTIALS` | 401 | Wrong e-mail or password |
| `TOTP_REQUIRED` / `TOTP_INVALID` | 401 | Second factor needed or wrong |
| `OTP_INVALID` / `OTP_RATE_LIMITED` | 401 / 400 | Phone code wrong, expired, or asked for too often |
| `FORBIDDEN` | 403 | Authenticated but missing a permission; `details.missing` lists them |
| `NOT_FOUND` | 404 | No such record |
| `ALREADY_EXISTS` | 409 | Unique constraint, e.g. a duplicate SKU |
| `NO_SHIPPING_RATE` | 400 | No active rate for that wilaya and delivery type |
| `TOO_MANY_REQUESTS` | 429 | Rate limit |
| `INTERNAL_ERROR` | 500 | Anything unexpected; details stay in the log |

**Correlation id.** Every response carries `x-correlation-id`, echoed into the error
envelope. Quote it in a bug report and the request is findable in the logs.

**Rate limits.** 120 requests per minute per IP by default. Sign-in is 10/min, OTP
requests 5/min.

---

## Authentication

Access tokens are JWTs valid for 15 minutes and are sent as `Authorization: Bearer …`.
The refresh token lives in the `jk_refresh` httpOnly cookie and never reaches
JavaScript. Refreshing rotates it; presenting a rotated token twice revokes the whole
session chain, because that means it was stolen.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/staff/login` | public | `{ email, password, totp? }` |
| POST | `/auth/otp/request` | public | `{ phone, purpose }`; returns `devCode` outside production |
| POST | `/auth/otp/verify` | public | `{ phone, code }`; creates the customer on first use |
| POST | `/auth/refresh` | cookie | Rotates the refresh cookie |
| POST | `/auth/logout` | bearer | Revokes this session |
| POST | `/auth/logout-all` | bearer | Revokes every session for the user |
| GET | `/auth/me` | bearer | The principal with roles and permissions |
| POST | `/auth/2fa/begin` | bearer | Returns a TOTP secret and `otpauth://` URL |
| POST | `/auth/2fa/enable` | bearer | `{ secret, code }` |

### Permissions

Admin routes declare permission strings enforced by `PermissionsGuard`. The catalogue
lives in `packages/shared/src/enums/permissions.ts` and is seeded into the database, so
the code and the roles screen can never disagree.

Roles: `owner`, `manager`, `order_agent`, `warehouse`, `driver`, `marketing`,
`accountant`.

---

## Public storefront

| Method | Path | Notes |
|---|---|---|
| GET | `/storefront/bootstrap` | Settings, menus and announcements for first paint |
| GET | `/storefront/home` | Home builder sections in display order |
| GET | `/storefront/pages` | Published CMS pages |
| GET | `/storefront/pages/:slug` | One CMS page |
| GET | `/storefront/sitemap` | Slugs and timestamps for `sitemap.xml` |

### Catalog

| Method | Path | Notes |
|---|---|---|
| GET | `/catalog/products` | Filter, sort, paginate — see below |
| GET | `/catalog/products/:slug` | Variants, media, attributes, computed availability |
| GET | `/catalog/collections` | Published collections |
| GET | `/catalog/collections/:slug` | Collection plus its products |
| GET | `/catalog/facets` | Facet counts for the filter rail |
| GET | `/catalog/search?q=` | Typo-tolerant search over products and collections |

`GET /catalog/products` query parameters:

| Parameter | Type | Notes |
|---|---|---|
| `q` | string | Free text |
| `collection`, `category` | slug | A smart collection resolves its rules at request time |
| `brand`, `color`, `size`, `tag` | repeatable | Multi-select; repeat the key |
| `minPrice`, `maxPrice` | minor units | |
| `inStock`, `onSale` | boolean | |
| `sort` | enum | `relevance` `best_selling` `newest` `price_asc` `price_desc` `name_asc` `name_desc` `discount` |
| `page`, `perPage` | integer | `perPage` caps at 60 |

Availability is computed server-side. The response exposes `available` and `inStock`
per variant, never the raw warehouse rows.

### Shipping

| Method | Path | Notes |
|---|---|---|
| GET | `/shipping/wilayas` | The 58 wilayas |
| GET | `/shipping/wilayas/:code/communes` | Dependent select for checkout |
| GET | `/shipping/wilayas/:code/pickup-points` | Stop-desk points |
| GET | `/shipping/quote` | `wilayaCode`, `deliveryType`, `weightGrams`, `subtotal` |

The quote applies the weight allowance, then the per-kilo surcharge, then the
free-shipping threshold. `cost` — what the courier charges us — is stripped from the
public response.

### Media

`GET /media/*key` streams a stored object. Used in development, where the local storage
driver has no CDN in front of it. In production `S3_PUBLIC_URL` points the storefront
straight at the bucket and this route is idle.

---

## Admin

Every admin list endpoint takes the same query parameters and returns the same envelope.

| Parameter | Notes |
|---|---|
| `page`, `pageSize` | `pageSize` caps at 100 |
| `sort`, `order` | `sort` must be in that endpoint's whitelist; anything else is a 400 `INVALID_SORT` naming the allowed keys |
| `q` | Free text over the columns the module declares |
| `filter[name]` | Repeat the key for multiple values |
| `format` | `csv` or `xlsx`; streams a file of the whole filtered set, ignoring pagination |

Responses carry `meta: { page, pageSize, total, totalPages }`.

| Method | Path | Permission |
|---|---|---|
| GET | `/admin/dashboard/summary?period=` | `reports.read` |
| GET | `/admin/orders` | `orders.read` |
| GET | `/admin/orders/counts` | `orders.read` |
| GET | `/admin/search?q=` | `orders.read` |
| GET | `/admin/events` | `orders.read` |
| GET POST PATCH DELETE | `/admin/views` | `orders.read` |
| GET | `/admin/media` | `catalog.read` |
| POST | `/admin/media` | `catalog.write` |
| GET PATCH | `/admin/media/:id` | `catalog.read` / `catalog.write` |
| POST | `/admin/media/:id/reprocess` | `catalog.write` |
| DELETE | `/admin/media/:id` | `catalog.delete` |
| GET POST | `/admin/media/folders` | `catalog.read` / `catalog.write` |
| DELETE | `/admin/media/folders/:id` | `catalog.write` |
| GET | `/admin/products` | `catalog.read` |
| GET | `/admin/products/counts` | `catalog.read` |
| GET | `/admin/products/import/template?format=` | `catalog.write` |
| POST | `/admin/products/import` | `catalog.write` |
| POST | `/admin/products` | `catalog.write` |
| PATCH | `/admin/products/bulk` | `catalog.write` |
| POST | `/admin/products/archive` | `catalog.write` |
| POST | `/admin/products/delete` | `catalog.delete` |
| GET PATCH DELETE | `/admin/products/:id` | `catalog.read` / `catalog.write` / `catalog.delete` |
| POST | `/admin/products/:id/duplicate` | `catalog.write` |
| POST | `/admin/products/:id/variants/generate` | `catalog.write` |
| PATCH | `/admin/products/:id/variants` | `catalog.write` |
| POST | `/admin/products/:id/variants/reorder` | `catalog.write` |
| POST | `/admin/products/:id/price-schedules` | `catalog.write` |
| DELETE | `/admin/products/:id/price-schedules/:scheduleId` | `catalog.write` |
| GET POST | `/admin/categories` | `catalog.read` / `catalog.write` |
| POST | `/admin/categories/reorder` | `catalog.write` |
| GET PATCH DELETE | `/admin/categories/:id` | `catalog.read` / `catalog.write` / `catalog.delete` |
| POST | `/admin/categories/:id/move` | `catalog.write` |
| GET POST | `/admin/collections` | `catalog.read` / `catalog.write` |
| POST | `/admin/collections/preview` | `catalog.read` |
| GET PATCH DELETE | `/admin/collections/:id` | `catalog.read` / `catalog.write` / `catalog.delete` |
| GET POST | `/admin/collections/:id/products` | `catalog.read` / `catalog.write` |
| POST | `/admin/collections/:id/products/{remove,reorder}` | `catalog.write` |
| POST | `/admin/collections/:id/merchandising` | `catalog.write` |
| GET POST | `/admin/{brands,tags,attributes,size-guides,search-synonyms}` | `catalog.read` / `catalog.write` |
| PATCH DELETE | `/admin/{brands,tags,attributes,size-guides,search-synonyms}/:id` | `catalog.write` / `catalog.delete` |
| GET | `/admin/reviews` | `catalog.read` |
| GET | `/admin/reviews/counts` | `catalog.read` |
| POST | `/admin/reviews/moderate` | `reviews.moderate` |
| POST | `/admin/reviews/:id/reply` | `reviews.moderate` |
| DELETE | `/admin/reviews/:id` | `reviews.moderate` |

**Dashboard.** `period` is `7d`, `30d`, `90d`, `mtd` or `ytd`. The response has KPI tiles
with a comparison against the preceding window of equal length, a daily series, and the
"needs attention" counters. It reads the pre-aggregated `daily_stats` table, so it does
not get slower as orders accumulate.

**Orders.** Read-only for now; transitions, edits and documents land in M3. Sortable by
`createdAt`, `number`, `total`, `status`, `customer`, `wilaya`, `deliveredAt`. Filterable
by `status`, `paymentStatus`, `paymentMethod`, `wilayaCode`, `source`, `from`, `to`.
`/counts` returns per-status totals for the list tabs, computed against every filter
except status, so a tab shows its own count while another tab is open.

**Search.** Backs the command palette. Matches order numbers, customer names and phone
numbers — normalized to E.164 first, so `0551 23 45 67` finds `+213551234567` — plus
product names and SKUs. Groups the caller lacks permission for are never queried.

**Events.** A server-sent stream. Frames are `connected`, then `ping` every 25 seconds,
then `order.created`, `order.transitioned`, `shipment.updated`, `inventory.low` and
`notification`. An event may declare required permissions and is filtered per subscriber.

**Views.** Saved list state per user and module. A shared view is readable by anyone who
can see the module but editable only by its author.

**Media.** `POST /admin/media` is `multipart/form-data` with one or more `files` and an
optional `folderId`. Each file is validated on its own, so one bad file does not lose the
batch: the response is `{ data: [...created], meta: { uploaded, failed: [{ fileName,
message }] } }`.

The declared content type is ignored. The leading bytes decide, against a closed set:
JPEG, PNG, WebP, AVIF, GIF, SVG, MP4, WebM, GLB and PDF. Limits are 20 MB for an image,
200 MB for a video, 15 MB for a GLB. A rejected file returns `UNSUPPORTED_TYPE` or
`FILE_TOO_LARGE`.

Images are queued for processing and come back with `processedAt: null`. The worker then
produces `thumb` (200), `card` (600) and `zoom` (1600) in both WebP and AVIF, records the
source dimensions and a dominant colour, and sets `processedAt`. A failure is recorded in
`processingError` and can be retried with `POST /admin/media/:id/reprocess`.

A GLB is Draco-compressed; `originalSizeBytes` keeps the size before compression, and a
poster is extracted from its first embedded texture when it has one.

`DELETE` refuses with `MEDIA_IN_USE` and a `usageCount` while anything references the
file. `GET /admin/media` accepts `kind`, `folderId` (`root` for the top level) and
`unusedOnly=true` — as plain parameters, not through `filter[...]`.

**Products.** Sortable by `createdAt`, `updatedAt`, `name`, `status`, `price`, `stock`,
`sales`, `rating`. Filterable by `status`, `categoryId`, `collectionId`, `brandId`,
`tagId`, `stock` (`in`, `low`, `out`), `minPrice`, `maxPrice` and `hasMedia`. "Low" means
at or under the product's own threshold, which is a column-to-column comparison and so is
resolved with one indexed query rather than a filter expression. Search covers names, slugs
and SKUs. `/counts` returns per-status totals for the list tabs.

`POST` creates the product with its first variants. Options are not part of that payload:
their values need the product to exist before a variant can reference them, which is what
`POST /:id/variants/generate` is for. `PATCH` writes only the keys it is sent.

**Variants.** `generate` replaces the option sets and rebuilds the matrix. A combination
that still applies keeps its SKU, price, cost and stock; one that no longer applies is
deleted if it has never been ordered and deactivated if it has, so an order from last month
still resolves its line to a real SKU. Three options and 300 combinations are the ceiling.

`PATCH /:id/variants` writes the whole grid: entries with an id are updated, entries
without one created, and a variant the grid no longer lists is retired the same way. A
product always keeps at least one variant.

**Prices.** `POST /:id/price-schedules` queues a change for one or more variants; the
worker applies it at `startsAt` and reverts it at `endsAt`. A schedule that has already run
cannot be cancelled — edit the price instead.

**Bulk.** `PATCH /admin/products/bulk` takes a selection and a set of changes: status,
category, brand, collections to add or remove, tags to add or remove, and a price
operation. The price move is an operation (`set`, `increase`, `decrease`, by amount or by
percentage, against `price`, `compareAtPrice` or `costPrice`) rather than a final amount,
so "raise everything 10 %" rounds once, in the API, on minor units.

**Import.** `POST /admin/products/import` is `multipart/form-data` with one `file`, CSV or
XLSX, plus `dryRun` (default true) and `updateExisting` (default true). One row is one
variant keyed by SKU; rows sharing a slug become one product with several variants. Prices
are read in dinars. The response is a validation report: counts of what would be or was
created and updated, plus one issue per problem with its row number and column.
`GET /admin/products/import/template` returns the same columns as a blank sheet.

**Categories.** `GET` returns the whole tree with per-node product counts — it is tens of
rows, so it is not paginated. `POST /:id/move` takes a new parent and index; the API
rewrites the materialized `path` of the node and its whole subtree in one transaction
(D09) and refuses a move into the node's own branch. Deleting is refused while the category
has children or products.

**Collections.** A smart collection's `productCount` is the live match count, computed from
its rules on every read. `POST /admin/collections/preview` runs a rule set that has not
been saved yet and returns what it would select, through the same translator the storefront
uses (D35). Manual membership endpoints refuse on a smart collection with
`SMART_COLLECTION_MANUAL`.

**Merchandising.** `POST /admin/collections/:id/merchandising` sets `pinned`, `hidden` and
`boost` per product within one collection, creating the row on demand for a smart
collection (D36). A hidden product stays published but leaves that collection's grid.

**Reviews.** Filterable by `status`, `rating`, `productId` and `verified`; searchable over
the body, title and author. Moderation is a selection plus a target status, and every
status change recomputes the product's rating rollup in the same transaction, so the stars
a shopper sees only ever count approved reviews. `reply` publishes the shop's answer; an
empty string clears it.

**Search synonyms.** Maintained here, applied by the public `/catalog/search` — see D39.

---

## Cart

Public. The cart is addressed by an httpOnly `jk_cart` cookie the browser cannot read;
the cart id never travels. A signed-in shopper's identity comes from the optional bearer
token, so one endpoint serves guests and members.

| Method | Path | Notes |
|---|---|---|
| GET | `/cart` | Creates one on first call; revalidates on every read |
| POST | `/cart/items` | `{ variantId, quantity }`; tops up a line that already holds the variant |
| PATCH | `/cart/items/:id` | `{ quantity }`; zero removes the line |
| DELETE | `/cart/items/:id` | Remove a line |
| DELETE | `/cart` | Empty the cart |
| POST | `/cart/promo` | `{ code }`; a refusal returns the reason, and the code is not stored |
| DELETE | `/cart/promo` | Remove the applied code |
| PATCH | `/cart/delivery` | `{ wilayaCode, deliveryType }`; makes shipping quotable |
| POST | `/cart/merge` | Folds the guest basket into the signed-in shopper's own |

**Every read revalidates.** Prices, stock and promotion validity are checked before the
cart is returned. A line whose product was unpublished is dropped, a line whose stock
fell is trimmed, and a price that moved is flagged. The response carries `notices` and a
per-line `adjusted` so the drawer can say what changed instead of silently differing
from what the shopper last saw.

**No client-side arithmetic.** `subtotalMinor`, `discountMinor`, `shippingMinor` and
`totalMinor` all come from the server, computed by the promo engine and the shipping
quote. A browser that adds up its own total is a browser that can be wrong about it.

**Promotions.** The engine (`apps/api/src/modules/promotions/engine`) is pure and
covers percentage, fixed amount, free shipping, tiered, buy-X-get-Y and bundle price.
Discounts are always allocated per line, so returning one line gives back exactly the
share of the discount that belonged to it. Refusals use the codes in `PROMO_REJECTIONS`
and carry a sentence written for the shopper.

---

## Checkout and orders

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/orders` | public | Places a cash-on-delivery order from the current cart |
| GET | `/admin/orders` | `orders.read` | List and export; `/counts` for the tabs |
| GET | `/admin/orders/:id` | `orders.read` | Items, timeline, notes, calls, risk, margin |
| POST | `/admin/orders/:id/transition` | `orders.transition` | The only way a status ever changes |
| POST | `/admin/orders/bulk` | `orders.transition` | One action over a selection; refusals reported per order |
| PATCH | `/admin/orders/:id` | `orders.write` | Customer and delivery details, before packing only |
| POST | `/admin/orders/:id/notes` | `orders.write` | Internal note |
| POST | `/admin/orders/:id/call-logs` | `orders.write` | Outcome and any callback time |
| PATCH | `/admin/orders/:id/tags` | `orders.write` | Replaces the tag set |
| POST | `/admin/orders/:id/assign` | `orders.write` | Assign to an agent |

**`POST /orders` is idempotent.** Send an `Idempotency-Key` header. A repeat returns the
original order rather than creating a second one, enforced twice: a Redis lock for two
simultaneous requests, and a unique column for a replay hours later. If Redis is
unreachable the request proceeds, because the column is what actually guarantees it.

**Nothing is trusted from the browser.** The cart is re-priced, the shipping re-quoted
and the stock re-checked at the moment of the order. Line items snapshot the product
name, the price *and the cost*, so an order stays readable and its margin stays correct
after the catalogue changes.

**Risk is advisory, not a gate** — PRD F-AD-31. Failed-delivery history, duplicates
inside the window, orders per phone per day, orders per IP per hour, order size against
the shop's average, phone verification and address specificity produce a 0-100 score and
a list of flags. Only a blacklist blocks; the flood patterns ask for a captcha. Nothing
else refuses an order, because refusing a real customer costs more than a wasted trip.

**Every status change goes through one door.** `OrderService.transition` applies the
state machine of PRD Section 7 inside a single transaction: stock moves, payment status,
timestamp, event row, promo release and customer rollups. An illegal move returns
`ILLEGAL_TRANSITION` naming what *is* allowed from there.

Stock has two distinct states. `stockReserved` holds units against availability;
`stockDeducted` means they have left the shelf. The deduction moment is configurable
(`orders.stock_deduction_moment`), and deducting always releases the reservation that
covered it — otherwise the same units are counted twice.

**Payment providers.** `cod` is always available and is the fallback for everything;
`chargily` (CIB / Edahabia) is switched on in Settings › Payments. A Chargily webhook is
verified by HMAC against the raw body *before* any field of it is read.

**Notifications.** Order events enqueue `notification.dispatch`. The worker resolves the
recipient, renders the template in the customer's own language, and picks a transport:
log (default), SMTP, Twilio, a configurable HTTP gateway for Algerian providers, WhatsApp
Cloud, or Telegram for owner alerts. Every message carries a dedupe key with a unique
index, so a queue retry can never send the same SMS twice.

---

## Promotions

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/admin/promotions` | `promotions.read` | List and export, with what each one gave away |
| GET | `/admin/promotions/counts` | `promotions.read` | Row counts per state, for the tabs |
| GET | `/admin/promotions/:id` | `promotions.read` | Conditions, targets and limits |
| GET | `/admin/promotions/:id/performance` | `promotions.read` | Uses, discount, revenue and margin, delivered orders only |
| GET | `/admin/promotions/:id/codes` | `promotions.read` | The unique codes generated for it |
| POST | `/admin/promotions` | `promotions.write` | Create |
| PATCH | `/admin/promotions/:id` | `promotions.write` | Update |
| POST | `/admin/promotions/:id/activate` | `promotions.write` | Switch on or off without editing |
| POST | `/admin/promotions/:id/codes/generate` | `promotions.write` | Bulk unique codes |
| DELETE | `/admin/promotions/:id` | `promotions.write` | Archives; the usage history stays |
| POST | `/admin/promotions/simulate` | `promotions.read` | Runs the live engine on a hand-built cart |

**The simulator is not a second implementation.** It builds a cart in memory and calls
the same `applyPromotions` the checkout calls, so what an owner sees is what a shopper
would be charged. It is exempt from the audit interceptor: it changes nothing, and
logging experiments would bury the writes that matter.

**State is derived, never stored.** A promotion is `draft`, `scheduled`, `active`,
`expired` or `exhausted` according to its dates, its switch and its usage against its
limit. There is no status column to fall out of step with the clock.

**Generated codes avoid `0`, `O`, `1` and `I`.** They are read off a screen and typed by
hand, and those four characters are where that goes wrong.

**Performance counts delivered orders only.** A promotion that pulled in fifty orders of
which forty were refused at the door did not work, and averaging the placed ones would
say it did.

---

## Storefront — reviews, wishlist, engagement and account

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/reviews/product/:productId` | public | Approved reviews plus the star distribution |
| GET | `/reviews/featured` | public | Best approved reviews shop-wide, for the home page |
| POST | `/reviews` | public | Submitted as `PENDING`; the verified badge is computed server-side |
| POST | `/reviews/:id/helpful` | public | Increments the helpful counter |
| GET POST DELETE | `/wishlist[/:id]` | customer | Adding twice is idempotent |
| POST | `/stock-notifications` | public | Back-in-stock request, deduplicated per person and variant |
| POST | `/marketing/newsletter` | public | Single opt-in; a repeat address is success, not an error |
| POST | `/marketing/newsletter/unsubscribe` | public | By e-mail or phone |
| POST | `/contact` | public | Lands as a `ContactMessage` and pings the admin over SSE |
| POST | `/events` | public | Batched analytics, up to 50 events |
| GET PATCH DELETE | `/account` | customer | Profile; delete scrubs contact details and keeps the orders |
| GET POST PATCH DELETE | `/account/addresses[/:id]` | customer | The first saved address becomes the default |
| GET | `/account/orders[/:number]` | customer | The shopper's own orders with their timeline |
| GET | `/account/loyalty` | customer | The points ledger |
| POST | `/orders/track` | public | `{ number, phone }` — both required |

**Tracking needs the phone.** Order numbers are sequential so they can be read out over
the telephone, which makes a number alone guessable. A wrong number and a wrong phone
return the same message, so the endpoint cannot be used to test whether a phone number
placed an order.

**Analytics carry no identifier.** The session id is random per browser tab and is never
joined to a person; a customer id is attached only when the shopper is already signed in.
Client timestamps more than a day from now are replaced, because a client clock can be
wrong or forged.

**The storefront session is a cookie.** `/auth/otp/verify` sets `jk_access` (15 minutes)
alongside the refresh cookie, so a Next.js server render can read the session and no
access token is ever held in browser JavaScript.

---

## Admin — inventory and purchasing

All routes require a staff token. Reads take `inventory.read`, writes `inventory.write`;
suppliers and purchase orders take `purchasing.read` / `purchasing.write`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/inventory` | `inventory.read` | Levels per variant × location; `format=csv\|xlsx` exports |
| GET | `/admin/inventory/summary` | `inventory.read` | On-hand, reserved, low, out, valuation |
| GET | `/admin/inventory/movements` | `inventory.read` | The stock ledger; same filters, same export |
| POST | `/admin/inventory/adjust` | `inventory.write` | Signed delta or absolute target, with a reason |
| POST | `/admin/inventory/bulk-adjust` | `inventory.write` | Up to 500 lines at one location, one transaction |
| POST | `/admin/inventory/transfer` | `inventory.write` | Two movements between locations |
| GET | `/admin/locations` | `inventory.read` | Every location with its unit count |
| POST/PATCH/DELETE | `/admin/locations[/:id]` | `inventory.write` | Delete refuses while stock or history exists |
| GET | `/admin/suppliers` | `purchasing.read` | Purchase totals per supplier; exports |
| GET | `/admin/suppliers/options` | `purchasing.read` | Active suppliers, for pickers |
| POST/PATCH/DELETE | `/admin/suppliers[/:id]` | `purchasing.write` | Delete is an archive |
| GET | `/admin/purchase-orders` | `purchasing.read` | List and export; `/counts` for the tabs |
| GET | `/admin/purchase-orders/:id` | `purchasing.read` | With lines and received quantities |
| POST/PATCH | `/admin/purchase-orders[/:id]` | `purchasing.write` | Editable while `DRAFT` only |
| POST | `/admin/purchase-orders/:id/place` | `purchasing.write` | `DRAFT` → `ORDERED`, counts units as incoming |
| POST | `/admin/purchase-orders/:id/receive` | `purchasing.write` | Moves stock and re-averages cost |
| POST | `/admin/purchase-orders/:id/cancel` | `purchasing.write` | Releases outstanding incoming units |
| GET | `/admin/stock-counts[/:id]` | `inventory.read` | Sessions with variance totals; `/:id/export` |
| POST | `/admin/stock-counts` | `inventory.write` | Opens a session, freezing expected quantities |
| PATCH | `/admin/stock-counts/:id/entries` | `inventory.write` | Saves counted quantities in batches |
| POST | `/admin/stock-counts/:id/apply` | `inventory.write` | Writes the variances as movements, closes it |
| GET | `/admin/variants/search` | `catalog.read` | SKU, barcode or product name, with availability |

**The ledger is the record.** No route writes `inventory_levels` directly. Every change
posts a signed `StockMovement` carrying its resulting balance, inside a transaction that
holds a row lock on the level, so two agents cannot both sell the last unit. Manual
corrections are the one path allowed to leave stock negative, because that is how an
operator fixes a level that already went negative.

**Receiving and cost.** A receipt allocates the order's freight and other costs across
the received lines in proportion to their value, then re-averages the variant's
`costPrice` against every unit held anywhere. Freight is charged once, on the first
receipt of an order. `GET /admin/purchase-orders/:id` reflects the new status:
`PARTIALLY_RECEIVED` while anything is outstanding, `RECEIVED` when nothing is.

**Counting.** A session freezes the expected quantity when it opens so a count is not
blamed for sales made while it was running. Applying compares the counted figure against
*live* stock and posts the difference; lines left uncounted are untouched.

---

## Admin — settings, users, roles, journal and backups

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/settings` | `settings.read` | Every scope at once, secrets masked |
| GET | `/admin/settings/:scope` | `settings.read` | One scope |
| PATCH | `/admin/settings/:scope` | `settings.write` | Partial: only the keys that changed |
| GET POST | `/admin/settings/templates` | `settings.read` / `settings.write` | Notification templates, upserted on (event, channel) |
| GET | `/admin/settings/templates/:id/preview` | `settings.read` | Renders with sample values |
| POST | `/admin/settings/templates/:id/test` | `settings.write` | Queues one real send |
| GET | `/admin/users` | `users.read` | Staff with roles and live session counts |
| PATCH | `/admin/users/:id` | `users.write` | Rename, re-role, deactivate |
| POST | `/admin/users/:id/sessions/revoke` | `users.write` | Signs them out everywhere |
| POST | `/admin/users/:id/two-factor/reset` | `users.write` | Clears the second factor and the sessions |
| GET POST | `/admin/users/invitations` | `users.read` / `users.write` | Create returns the one-time link |
| POST | `/auth/invitations/accept` | public | The invitee sets their own password |
| GET | `/admin/roles` | `users.read` | Roles with permissions and headcount |
| GET | `/admin/roles/permissions` | `users.read` | The catalogue the matrix draws |
| PATCH | `/admin/roles/:id/permissions` | `users.write` | Replaces the grants of one role |
| GET | `/admin/audit` | `audit.read` | Read-only; exports |
| GET | `/admin/audit/:entityType/:entityId` | `audit.read` | History of one record |
| GET POST | `/admin/backups` | `settings.read` / `settings.write` | Queues a dump; the list polls while it runs |

**Scopes, not keys.** Settings are validated per scope with a Zod schema in
`@jecks/shared`. A key that does not belong to the scope is refused rather than stored,
so a typo in a script fails loudly instead of creating a setting nothing reads.

**Secrets.** `notifications.sms_credentials`, `notifications.telegram_token` and the
Chargily keys are encrypted with `CREDENTIALS_KEY` (AES-256-GCM) and come back as a
mask. Sending the mask back means "leave it alone", so a settings form round-trips
without the browser ever holding the real value.

**No password is chosen for anyone.** An invitation stores only a hash of its token,
expires after 72 hours, and is single-use. Re-inviting the same address replaces the
pending invitation rather than leaving two live links.

**The last owner cannot be removed.** Deactivating, deleting or un-owning the only
active owner is refused: a shop with no owner has nobody who can grant the permission
needed to make one.

**Backups** are taken by the worker, never in the request. `POST /admin/backups` creates
a `Job` row and enqueues it; the dump is `pg_dump --format=custom`, stored under
`backups/`, pruned after 14 days, and the nightly run fires at 02:30 Africa/Algiers.

---

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness; no dependencies touched |
| GET | `/health/ready` | Readiness; includes a database round-trip |

---

## Planned surface

The modules below are specified in the PRD and scheduled by milestone. They are listed
here so integrators can see the shape of the finished API, not because they exist.

**M4 — delivery.** `/admin/shipping/{zones,rates,couriers,shipments,vehicles,drivers,runs,settlements}`,
`POST /webhooks/couriers/:provider`.

**M5 — finance and reporting.** `/admin/finance/{expenses,payments,pnl}`,
`/admin/reports/*`, `/admin/customers`.

**M6 — marketing.** `/marketing/newsletter`, `/reviews`, `/admin/content/*`.

Order creation and inbound webhooks will accept an `Idempotency-Key` header; a repeated
key returns the original result rather than creating a second order.
