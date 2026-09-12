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
| GET | `/admin/orders/:id/documents/invoice.pdf` | `orders.documents` | The invoice, with the shop's RC and NIF |
| GET | `/admin/orders/:id/documents/packing-slip.pdf` | `orders.documents` | The picking sheet, with no prices on it |
| POST | `/admin/orders/documents/batch` | `orders.documents` | Either document for up to 200 orders, one per page |
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
| GET | `/admin/payments/providers` | `settings.read` | Each payment provider and whether it is switched on |
| POST | `/admin/payments/providers/:key/test` | `settings.write` | Asks the gateway whether the key works |
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

**Every integration can be tested from its own screen**, because "the key is stored" and
"the key works" are different facts and only the second one matters. A courier is tested
with a tracking call for a number that cannot exist, which exercises authentication
without putting a parcel into their system. A payment gateway is tested with a read, not
a one-dinar checkout that would leave a row in the shop's dashboard each time. A
notification template is tested by sending a real message to a chosen address.

**Backups** are taken by the worker, never in the request. `POST /admin/backups` creates
a `Job` row and enqueues it; the dump is `pg_dump --format=custom`, stored under
`backups/`, pruned after 14 days, and the nightly run fires at 02:30 Africa/Algiers.

---

**An invoice and a packing slip are not the same document.** The invoice carries the
totals, the amount still due at the door, and the shop's trade register, tax number and
article — the three identifiers that make it an invoice in Algeria. The packing slip
carries none of them: whoever fills the box does not need the figures, and a slip in the
parcel showing what it cost is how a shop gets an awkward phone call from a customer's
neighbour. It carries the order note instead, which is where the delivery instruction
usually is.

Batch printing is the normal case rather than the exception, so both are generated a
page per order, in the order asked for, and an empty selection returns a valid one-page
PDF saying so rather than a file that will not open.

---

## Delivery, the fleet and cash

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET POST PATCH DELETE | `/admin/shipping/zones[/:id]` | `delivery.read` / `write` | A wilaya belongs to one zone at most |
| GET | `/admin/shipping/rates` | `delivery.read` | Optionally for one zone or courier |
| GET | `/admin/shipping/rates/matrix` | `delivery.read` | Every wilaya with its home and stop-desk cell |
| POST | `/admin/shipping/rates/bulk` | `delivery.write` | Up to 500 cells in one transaction |
| POST PATCH DELETE | `/admin/shipping/rates[/:id]` | `delivery.write` | The last rate serving a wilaya cannot be deleted |
| GET | `/admin/couriers` | `delivery.read` | Readiness and the cash each one holds |
| GET | `/admin/couriers/providers` | `delivery.read` | Credential fields per adapter, for the form |
| POST PATCH DELETE | `/admin/couriers[/:id]` | `delivery.write` | Deleting one that has carried parcels deactivates it |
| POST | `/admin/couriers/:id/credentials` | `delivery.write` | Encrypted at rest; never returned |
| POST | `/admin/couriers/:id/test` | `delivery.write` | Checks authentication without creating a parcel |
| GET | `/admin/shipments` | `delivery.read` | List, filter and export |
| GET | `/admin/shipments/:id` | `delivery.read` | With the courier's own event trail |
| POST | `/admin/shipments` | `delivery.dispatch` | A batch; failures are reported per order |
| POST | `/admin/shipments/labels` | `delivery.read` | Streams a printable PDF |
| POST | `/admin/shipments/import-tracking` | `delivery.dispatch` | The spreadsheet a manual courier sends back |
| PATCH | `/admin/shipments/:id` | `delivery.write` | Correct a tracking number or a cost |
| POST | `/admin/shipments/:id/cancel` | `delivery.dispatch` | Refused once delivered |
| GET POST PATCH DELETE | `/admin/vehicles[/:id]` | `delivery.read` / `write` | |
| GET POST PATCH DELETE | `/admin/drivers[/:id]` | `delivery.read` / `write` | Creates the staff account when there is none |
| GET | `/admin/delivery-runs` | `delivery.read` | By day, driver or status |
| GET | `/admin/delivery-runs/assignable` | `delivery.dispatch` | Orders not yet on any run |
| GET | `/admin/delivery-runs/:id/manifest` | `delivery.read` | The sheet the driver signs |
| POST PATCH | `/admin/delivery-runs[/:id]` | `delivery.dispatch` | Date, driver, vehicle |
| POST | `/admin/delivery-runs/:id/orders` | `delivery.dispatch` | Load orders onto the run |
| POST | `/admin/delivery-runs/:id/reorder` | `delivery.dispatch` | Apply a hand-dragged order |
| POST | `/admin/delivery-runs/:id/optimise` | `delivery.dispatch` | Nearest neighbour, then 2-opt |
| POST | `/admin/delivery-runs/:id/{start,complete,cancel}` | `delivery.dispatch` | |
| PATCH | `/admin/delivery-runs/:id/stops/:stopId` | `delivery.dispatch` | What happened at a door |
| GET | `/driver/run` | `delivery.own_runs` | The signed-in driver's own round |
| PATCH | `/driver/runs/:id/stops/:stopId` | `delivery.own_runs` | Delivered, failed or rescheduled |
| GET | `/admin/cash/daily` | `delivery.read` | Expected against collected, per holder |
| POST | `/admin/cash/reconcile` | `delivery.settle` | Count cash in, one collection at a time |
| GET POST | `/admin/settlements[/:id]` | `delivery.read` / `settle` | Build from delivered, unsettled parcels |
| POST | `/admin/settlements/:id/pay` | `delivery.settle` | A shortfall stays visible as a difference |
| GET | `/admin/delivery/analytics` | `delivery.read` | Success rate and transit time, split every way |
| POST | `/webhooks/couriers/:provider` | signature | Verified against the raw body before it is read |
| POST | `/internal/couriers/sync` | internal token | What the worker calls on the clock |

**Five couriers, one interface.** `manual` is the default and a real implementation: a
shop that hands parcels over at a counter and types the numbers back in runs the same
code path as one with an API key. Yalidine, ZR Express, Maystro and EMS each translate
their own vocabulary; nothing above the adapter knows what a "Yalidine parcel" is.

Three details break these integrations more than anything else, so all three are tested
against a stubbed HTTP client: every Algerian carrier bills in **whole dinars** while
the platform stores centimes, Yalidine addresses by wilaya **name** where ZR uses the
**code**, and their status vocabularies share no words.

**A driver sees their own run and nobody else's.** Every `/driver` route resolves the
driver from the session rather than taking an id, so changing a number in a URL returns
403. That is acceptance criterion 6, enforced by the API rather than by hiding a link.

**Cash has three numbers, kept apart.** *Expected* is what the delivered orders say was
due, *collected* is what the driver or courier reported, and *reconciled* is what has
been counted in at the office. A gap between the first two is a conversation with a
driver; a gap between the last two is cash that simply has not come back yet.

**Settlements never count a parcel twice.** A shipment already on another settlement is
skipped, which makes regenerating an overlapping period safe after a late delivery
lands. Fees are the delivery charge plus the courier's COD commission, rounded half-up
because that is what their own statement does.

**Only Maystro pushes.** The other adapters are polled by the `courier.sync` job every
twenty minutes. The worker owns the clock and the API owns the integration: the worker
calls one internal endpoint rather than carrying a second copy of every status mapping
and every credential.

---

## Finance, reporting and customers

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/admin/finance/pnl` | `finance.read` | Grouped nine ways, optionally compared to the period before |
| GET POST PATCH DELETE | `/admin/finance/expenses[/:id]` | `finance.read` / `write` | The list carries its own filtered total |
| GET POST PATCH DELETE | `/admin/finance/expenses/categories[/:id]` | `finance.read` / `write` | A category with expenses cannot be deleted |
| POST | `/admin/finance/expenses/generate-recurring` | `finance.write` | Writes the occurrences a series owes |
| GET POST DELETE | `/admin/finance/ad-spend[/:id]` | `finance.read` / `write` | The same day and campaign replaces rather than adds |
| GET | `/admin/finance/ad-spend/summary` | `finance.read` | ROAS and cost per order, attributed by UTM source |
| GET POST | `/admin/finance/ledger` | `finance.read` / `write` | Signed entries; balances are derived |
| GET | `/admin/finance/ledger/balances` | `finance.read` | Cash, bank, courier, customer |
| GET | `/admin/reports` | `reports.read` | The library: seventeen named reports |
| GET | `/admin/reports/:key` | `reports.read` | Runs one; add a format to stream it as a file |
| POST | `/admin/reports/:key/exports` | `reports.export` | Queues a full export; returns a row to poll |
| GET | `/admin/reports/exports[/:id]` | `reports.export` | Recent exports and their download links |
| GET | `/admin/customers` | `customers.read` | Value, reliability and segment; list and export |
| GET | `/admin/customers/segments` | `customers.read` | How many are in each, and what they are worth |
| GET | `/admin/customers/:id` | `customers.read` | Orders, addresses, notes and the points ledger |
| POST PATCH | `/admin/customers[/:id]` | `customers.write` | |
| POST | `/admin/customers/:id/notes` | `customers.write` | Internal note |
| POST | `/admin/customers/:id/blacklist` | `customers.write` | Blocking takes a reason |
| POST | `/admin/customers/:id/loyalty` | `customers.write` | Manual adjustment, with a reason |
| GET | `/admin/customers/merge-preview` | `customers.write` | What a merge would move, before agreeing to it |
| POST | `/admin/customers/merge` | `customers.write` | Cannot be undone |
| GET POST PATCH DELETE | `/admin/customers/groups[/:id]` | `customers.read` / `write` | Group pricing |
| GET | `/admin/dashboard/insights` | `reports.read` | Wilaya breakdown, order heatmap, funnel, activity |
| POST | `/internal/maintenance/{recurring-expenses,segments,loyalty-expiry}` | internal token | What the worker calls nightly |

**Revenue counts delivered orders.** In a cash-on-delivery market a placed order is a
request: counting it as revenue makes a shop with a 60 % delivery rate look twice as
profitable as it is. `finance.revenue_basis` can switch to "paid" for a shop that trades
mostly online, and every answer says which basis produced it.

**Discounts are reported, never subtracted twice.** Revenue is what was actually charged
and already has the discount taken off. The discount line exists so it can be seen, not
so it can be deducted again.

**Gross profit is goods only.** Delivery has a margin of its own, payment fees are their
own line, and refunds come off the net. One function in `@jecks/shared` computes all of
it, because the API serves the report and the worker writes the nightly row, and two
implementations would eventually disagree.

**Period costs are shared out by revenue.** Rent belongs to no wilaya, but a P&L grouped
by wilaya that ignores rent flatters every row. The remainder from the division goes to
the largest group, so the parts always add back to the whole.

**Points are earned at the door.** Loyalty accrues when an order is delivered and is
taken back if it comes home again, floored at zero. Awarding at checkout would hand
points to everyone who refuses the parcel.

**Merging admits the phone number was wrong.** Everything moves to the surviving record
and the other is archived rather than deleted. A blacklisted record refuses to merge into
a clean one: that would launder the history the blacklist exists to keep.

---

**Two ways to export a report, for two different questions.** Adding `format` to the
report itself streams the file straight back, which is right for the hundred rows on the
screen. A year of order lines is a different matter: the browser holds a connection open
for a minute and a proxy gives up at thirty seconds. So the second path queues a job, the
row appears immediately, the worker runs it, and the file lands in storage with a link.

The queued path carries no row limit, and it needs `reports.export` rather than
`reports.read`, because a full export is a copy of the shop's numbers leaving the shop.
Who asked is recorded on the job.

---

## Content and marketing

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET POST PATCH DELETE | `/admin/content/home[/:id]` | `content.read` / `write` | Home sections, in drawing order |
| POST | `/admin/content/home/reorder` | `content.write` | One transaction, so the page never renders half-sorted |
| GET POST PATCH DELETE | `/admin/content/banners[/:id]` | `content.read` / `write` | Grouped by placement |
| GET POST PATCH DELETE | `/admin/content/announcements[/:id]` | `content.read` / `write` | The strip above the header |
| GET POST PATCH DELETE | `/admin/content/pages[/:id]` | `content.read` / `write` | Renaming a published page writes its redirect |
| GET POST DELETE | `/admin/content/menus[/:id]` | `content.read` / `write` | Items as a tree |
| POST PATCH DELETE | `/admin/content/menus/:id/items`, `/items/:itemId` | `content.write` | Two levels, which is what a mega-menu is |
| GET POST DELETE | `/admin/content/redirects[/:id]` | `content.read` / `write` | A loop is refused |
| GET | `/admin/marketing/newsletter` | `marketing.read` | The subscriber list, with stats and sources |
| POST | `/admin/marketing/newsletter/sync` | `marketing.write` | Copies the list to the configured provider |
| GET | `/admin/marketing/abandoned-carts` | `marketing.read` | Open, contacted or recovered |
| POST | `/admin/marketing/abandoned-carts/contact` | `marketing.write` | Queues a recovery message; each cart once |
| GET POST PATCH DELETE | `/admin/marketing/affiliates[/:id]` | `marketing.read` / `write` | With what their code actually earned |

**Anything scheduled carries a window.** Home sections, banners and announcements each
have `startsAt` and `endsAt`, and the storefront filters on read. A banner for a sale
that ended at midnight disappears by itself rather than waiting for somebody to switch it
off. The admin shows an out-of-window item greyed rather than hiding it, so a promotion
scheduled for next week is visible today.

**Renaming a published page writes the redirect.** A shop that changes `/livraison` to
`/expedition` has just broken every link to it and will not find out for months, so the
old address is pointed at the new one at the moment of the rename.

**The shop owns the newsletter list.** A provider gets a copy, never the original, and
unsubscribes travel out with everyone else: leaving them behind would let the next
campaign reach somebody who asked not to be mailed. `log` is the default and a real
implementation; Brevo is switched on in Settings. A phone-only subscriber is counted as
skipped rather than silently dropped, because Brevo keys contacts by e-mail.

**Affiliate commission counts delivered orders.** An influencer whose audience orders and
refuses at the door has not sold anything, and paying commission on that is how these
arrangements go wrong.

---

## Operations and documents

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/metrics` | `x-internal-token` | Prometheus exposition; not in Swagger |
| GET | `/admin/ops/queues` | `settings.read` | Depths per queue plus the last 25 failures |
| POST | `/admin/ops/queues/retry` | `settings.write` | Body `{ queue, jobId }` |
| GET | `/documents/:token` | the token itself | A signed, expiring link to one stored file |

**`/metrics` is guarded by the internal token, not by a session.** Prometheus has no
user to sign in as, and the numbers say how many orders the shop takes, which is not
public. Unset `INTERNAL_API_TOKEN` and the route 404s rather than opening. The exposition
is written by hand — counters keyed by route *template*, so `/orders/:id` is one series
rather than one per order — and the business gauges beside them are the ones worth an
alert: unshipped orders older than a day, whether the cache is reachable, queue depth.

**The queue screen replaces Bull Board.** It reads the Redis keys BullMQ documents, so it
is the same truth a dashboard would show, behind the same permission as everything else,
without mounting a second application inside this one. A retry moves the job id from the
failed sorted set back onto the waiting list, which is what a retry is; the payload is
already stored.

**Signed document links** carry a storage key and an expiry, signed with
`CREDENTIALS_KEY` and valid fifteen minutes. They exist for the case where a document has
to leave the app — a label forwarded to a courier over WhatsApp — and everything else
goes through the authenticated admin route. The token is restricted to five storage
prefixes and any key containing `..` is refused, so a forged token cannot walk out of
them. Responses are `no-store` and `Content-Disposition: attachment`.

---

## Caching

Six catalogue reads are cached in Redis: the grid (60 s), a product (30 s), collections
(300 s), facets (60 s), and search (30 s). Nothing behind authentication is cached, and
no response containing a customer is.

Invalidation is **coarse on purpose**. A successful write to an admin route drops the
whole namespace it belongs to rather than computing which keys it touched — publishing
one product clears every catalogue key. Getting invalidation exactly right is where
caches go wrong, and the cost of being crude here is one repopulated cache after an edit.

The cache is optional. With Redis unreachable every read falls through to the database
and the site is slower, not broken.

---

## Cross-site request forgery

Most routes are driven by a bearer token, which a cross-origin page cannot read or
attach. The two exceptions are the routes a cookie alone authenticates —
`POST /auth/refresh` and `POST /auth/logout` — and those require a double-submit token:
a script-readable `jk_csrf` cookie whose value must be echoed in `x-csrf-token`.
Another origin can cause the cookie to be sent but cannot read it.

The cookie is issued at sign-in and on every refresh. A mismatch is `403` with
`CSRF_FAILED`. A request carrying a bearer token is exempt: the sender is not a browser,
so there is no cookie to forge.

---

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness; no dependencies touched |
| GET | `/health/ready` | Readiness; includes a database round-trip |

---

## Idempotency

`POST /orders` accepts an `Idempotency-Key` header, and a repeated key returns the
original order rather than creating a second one. It is enforced twice: a Redis lock
catches two simultaneous requests, and a unique column catches a replay hours later.

Inbound webhooks are idempotent on the sender's own reference instead. A courier that
resends the same event fifty times produces one event row and forty-nine no-ops; a
payment gateway that resends a capture finds the payment already recorded.
