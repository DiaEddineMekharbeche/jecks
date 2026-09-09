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

| Method | Path | Permission |
|---|---|---|
| GET | `/admin/dashboard/summary?period=` | `reports.read` |

`period` is `7d`, `30d`, `90d`, `mtd` or `ytd`. The response has KPI tiles with a
comparison against the preceding window of equal length, a daily series, and the
"needs attention" counters. It reads the pre-aggregated `daily_stats` table, so it does
not get slower as orders accumulate.

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

**M1 — catalog administration.** `/admin/products`, `/admin/variants`, `/admin/media`,
`/admin/categories`, `/admin/collections`, `/admin/inventory`, `/admin/settings`,
`/admin/users`, `/admin/audit`.

**M3 — checkout and orders.** `POST /cart`, `PATCH /cart/items`, `POST /cart/promo`,
`POST /orders`, `GET /orders/track`, `/admin/orders` with `/:id/transition`,
`/:id/call-logs` and `/:id/documents`, `/admin/promotions`.

**M4 — delivery.** `/admin/shipping/{zones,rates,couriers,shipments,vehicles,drivers,runs,settlements}`,
`POST /webhooks/couriers/:provider`.

**M5 — finance and reporting.** `/admin/finance/{expenses,payments,pnl}`,
`/admin/reports/*`, `/admin/customers`.

**M6 — marketing.** `/marketing/newsletter`, `/reviews`, `/admin/content/*`.

Order creation and inbound webhooks will accept an `Idempotency-Key` header; a repeated
key returns the original result rather than creating a second order.
