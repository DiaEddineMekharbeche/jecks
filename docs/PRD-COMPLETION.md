# Jeck's — Completion PRD (Milestones M1 → M7)
## From foundation to a fully working platform — no mocks, no placeholders

| | |
|---|---|
| **Document** | PRD v2 — completion plan. Companion to `docs/PRD.md` (v1, the functional contract). |
| **Date** | 2026-09-09 |
| **Baseline audited** | commit `8012b17` — "M0 foundation" + 2 fixes |
| **Audience** | Claude Code (Opus) implementation agent |
| **Goal** | Deliver every module of PRD v1 Sections 4–6 as **real, database-backed, tested** features. When this document is complete, the admin panel contains **zero** "planned" / placeholder screens and the owner can run the whole business from it. |

---

## 0. Instructions for the implementing agent

1. `docs/PRD.md` stays the functional source of truth (feature IDs `F-ST-xx`, `F-AD-xx`). This document tells you **what is already built, what is missing, and the exact order and definition of done** for the rest. Where the two disagree, this document wins because it reflects the audited codebase.
2. **Anti-mock rules (hard):**
   - No screen may render hardcoded arrays, fixture JSON, `faker` data, or `setTimeout`-simulated requests. Every list, tile, chart and form reads/writes through `apps/admin/src/lib/api.ts` → real NestJS endpoint → Prisma → PostgreSQL.
   - No `status: 'planned'` entries in `apps/admin/src/app/navigation.ts`; delete `PlannedModule` from `router.tsx` when the last module ships. Delete "Planned surface" from `docs/API.md` and replace it with the real routes.
   - No `TODO(Mx)` comments may remain at the end of M7. `grep -rn "TODO(M" apps packages` must return nothing.
   - Every notifier, courier, payment and storage provider ships with a **working default adapter** (log / manual / local / COD) and the provider interface. "Adapter scaffold" means the class compiles, is registered, is selectable in Settings, and has a unit test with a stubbed HTTP client — not an empty file.
   - Every admin CRUD page = list (server pagination, sort, filter, search, export) + create + edit + delete/archive + empty state + error state + loading skeleton + optimistic toast. A page missing any of these is not done.
3. Work milestone by milestone in the order of Section 3. Each milestone ends with: migrations committed, seed extended so the new screens show realistic data, unit + integration tests green, `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green, README "Status" section and `docs/API.md` updated, and a short entry in `docs/DECISIONS.md` for every open choice.
4. Reuse what exists. Do not re-create Zod schemas that already live in `packages/shared/src/schemas/{checkout,order,promotion,catalog}.ts`; extend them. Do not add tables that already exist among the 108 models in `schema.prisma`; add columns/tables only when a gap is listed in Section 2.3.
5. Build the **shared admin list framework first** (M1.0) and use it for every list afterwards. Duplicated table code across modules is a defect.
6. Keep the API the only place with business rules. Frontends compute nothing about money, stock, promos or statuses beyond display.

---

## 1. Audit of the current state (what exists today)

### 1.1 Built and real
| Area | Status | Notes |
|---|---|---|
| Monorepo, tooling, CI, Docker, Nginx | ✅ | pnpm + Turborepo, Vitest, GitHub Actions with Postgres/Redis services, prod compose |
| Prisma schema | ✅ 108 models | Covers PRD Section 8 completely incl. orders, shipping, fleet, finance, content, marketing, system |
| Seed | ✅ | 58 wilayas + communes, roles/permissions, 40 demo caps, 75 days of `daily_stats`, settings, CMS pages |
| Auth | ✅ | Staff password + TOTP 2FA, customer phone OTP (logged, not sent), rotating refresh tokens, RBAC guard, permission catalogue in `@jecks/shared` |
| Public catalog API | ✅ | Products/collections/facets/search (tsvector + pg_trgm), smart collections, shipping quote, wilayas/communes/pickup points |
| Settings API | ✅ read-only | `bootstrap`, `home`, `pages`, `sitemap` — **no write endpoints** |
| Storage | ✅ | `StorageProvider` local/S3, `GET /media/:key` |
| Storefront | ✅ browse-only | Home (3D hero, procedural geometry), collections + filter rail, PDP with variants/gallery/delivery estimator, search, CMS pages, sitemap/robots/JSON-LD, fr/ar/en RTL |
| Admin | ⚠️ shell only | Login, AppShell, permission-gated nav, **Dashboard (real, reads `daily_stats`)**. All 11 other nav entries render `PlannedModule` |
| Worker | ⚠️ partial | `daily-stats`, price schedules, abandoned-cart detection, low-stock alert collection run for real; **notifications, media processing, courier sync are log-only stubs** |
| Design system `@jecks/ui` | ⚠️ minimal | tokens, `Button`, `Field`, `Surface`, `EmptyState`, `Badge`, `cn`; Storybook. No table, dialog, sheet, tabs, select, combobox, date picker, toast, command palette |
| Tests | ⚠️ thin | 10 spec files: API common layer, worker jobs, money/phone. **No tests on catalog service, auth service, dashboard, storefront** |

### 1.2 Missing entirely (v1 PRD sections)
Storefront: cart drawer, checkout, order confirmation, order tracking, account (orders, addresses, wishlist, loyalty), reviews, wishlist, newsletter POST, "notify me", contact form, PWA, analytics events, cookie consent.
API: every `/admin/*` write module (catalog, media, inventory, purchasing, orders, customers, promotions, delivery, finance, reports, content, marketing, users, audit, settings write), cart, checkout, orders public, reviews, newsletter, webhooks, notifications, documents (PDF).
Admin: all modules except dashboard; global command palette; SSE live updates (endpoint decided D12 but not implemented); driver mobile view.
Worker: notification dispatch, image variants (sharp), GLB poster, courier tracking sync, report exports, settlement reminders, backup job.

### 1.3 Schema gaps to add (migration in the milestone indicated)
| Gap | Milestone |
|---|---|
| `Media.variants` JSONB (generated sizes) + `Media.posterKey` for GLB | M1 |
| `Product.publishAt`, `Product.archivedAt` if absent | M1 |
| `Order.idempotencyKey` unique, `Order.riskScore`, `Order.riskFlags` JSONB | M3 |
| `Cart.token` unique + `Cart.expiresAt` | M3 |
| `Notification.dedupeKey` unique, `NotificationTemplate.locale` composite unique | M3 |
| `Shipment.labelKey`, `Shipment.costMinor`, `Shipment.codAmountMinor` | M4 |
| `DeliveryRunStop.sequence`, `.proofKey`, `.cashCollectedMinor` | M4 |
| `DailyStat` extra columns: `shippingCost`, `discounts`, `returnsValue`, `expenses`, `paymentFees` | M5 |
| `SavedView` table (user, module, name, filters JSONB) | M1.0 |
| `ReportExport` table (job status, file key, requester) | M5 |

(Add only the ones actually absent after reading `schema.prisma`; record each in DECISIONS.)

---

## 2. Cross-cutting foundations to build once (M1.0 — before any module)

### 2.1 `@jecks/ui` completion
Add, shadcn-style on Radix, brand-tokened, with stories: `DataTable` (TanStack Table; server-driven; column visibility; row selection; bulk bar; sticky header; density), `Pagination`, `Dialog`, `Sheet` (side panel), `DropdownMenu`, `Tabs`, `Select`, `Combobox` (async search), `MultiSelect`, `DatePicker` + `DateRangePicker` with presets (today, 7d, 30d, MTD, custom, compare), `Switch`, `Checkbox`, `RadioGroup`, `Textarea`, `NumberInput` (money-aware, displays DA, stores minor units), `Toast` (with undo action), `Skeleton`, `StatTile` (value, delta, sparkline), `Kbd`, `CommandPalette` (cmdk), `Tooltip`, `Popover`, `Avatar`, `Stepper`, `FileDropzone` (multi-upload with progress & reorder), `RichTextEditor` (TipTap, multi-language tabs fr/ar/en with RTL), `TranslatedInput` (tabbed fr/ar/en text input), `StatusBadge` (maps enums → tone), `Timeline`, `KpiChart` wrappers (Recharts: line, bar, area, funnel, heatmap, choropleth of Algeria wilayas from a bundled GeoJSON).

### 2.2 Admin application framework
- `features/<module>/` structure: `api.ts` (typed calls), `queries.ts` (TanStack Query hooks + keys), `pages/`, `components/`.
- **List framework** `useServerTable(moduleKey, fetcher)`: URL-synced state (page, size, sort, filters, q), saved views (`GET/POST /admin/views`), export button (`?format=csv|xlsx` on the same list endpoint, streamed by API, ≤ 50k rows), bulk action bar.
- **Form framework**: React Hook Form + Zod resolver from `@jecks/shared`; field-level errors from `ApiRequestError.fieldErrors`; dirty-state guard on navigation; autosave draft for product editor.
- **Realtime**: `GET /admin/events` SSE (D12) with events `order.created`, `order.transitioned`, `shipment.updated`, `inventory.low`, `notification`; admin shows toast + sound toggle + badge counters on nav.
- **Command palette** ⌘K: search orders (number/phone), products (name/SKU), customers (phone/name), navigation.
- **Audit interceptor** (API): every mutating `/admin/*` route writes `AuditLog` (actor, entity, before/after diff, ip, correlationId). Register once as a NestJS interceptor; per-route opt-out decorator.

### 2.3 API conventions to enforce now
- All admin list endpoints accept `page, pageSize(≤100), sort, order, q, filter[...]` and return `{ data, meta: { page, pageSize, total } }`; `format=csv|xlsx` streams a file (`exceljs`, background job via `ReportExport` when total > 5k).
- All admin writes validated with Zod pipes from `@jecks/shared`; return the full updated entity.
- `Idempotency-Key` middleware for `POST /orders` and all `/webhooks/*` (Redis-backed, 24 h).
- Integration test harness: Testcontainers Postgres + Redis, `createTestApp()` helper, factory helpers for product/variant/customer/order. Every module below MUST add integration tests through this harness.

---

## 3. Milestones (jalons) — detailed scope & definition of done

Estimates assume one autonomous agent; treat as ordering, not a promise.

---

### M1 — Catalog, Media, Inventory, Settings, Users, Audit (admin becomes usable)

#### M1.0 Foundations (Section 2) — DoD: `DataTable` + one saved view + SSE ping + command palette work on the Dashboard.

#### M1.1 Media pipeline (F-AD-10 media, 6.3)
API `POST /admin/media` (multipart, ≤ 20 MB image, ≤ 15 MB GLB, MIME sniffing), `GET /admin/media` (folders, search, usage count), `PATCH /admin/media/:id` (alt, folder), `DELETE` (refuses when referenced). Worker `media.process`: sharp → `thumb 200`, `card 600`, `zoom 1600` WebP + AVIF, stores `Media.variants`; GLB → poster PNG via headless three (or `@gltf-transform` + `sharp` snapshot) and Draco compression. Storefront `next/image` loader uses variants. Admin: **Media library** page (grid, folders, upload dropzone, details sheet).
DoD: uploading a JPG creates 3 variants within 5 s; PDP serves WebP; GLB shows poster before load.

#### M1.2 Catalog admin (F-AD-10 – F-AD-13)
API `/admin/products` (list with facets: status, category, collection, stock state, price range; create; update; duplicate; archive; bulk update; bulk import CSV/XLSX with validation report; export), `/admin/products/:id/variants` (generate from options, update, reorder), `/admin/categories` (tree ops: move, reorder), `/admin/collections` (manual: add/remove/reorder; smart: rules CRUD + "preview matches"), `/admin/brands`, `/admin/tags`, `/admin/attributes`, `/admin/size-guides`, `/admin/reviews` (moderate, reply), `/admin/merchandising` (pins/boosts per collection, search synonyms). Catalog rollups (D25) recomputed on write.
Admin pages: Products list; **Product editor** (tabs: General / Media / Variants & Pricing / Inventory / Shipping / SEO / Related & Bundles) with autosave draft, margin % live, scheduled publish; Categories tree (drag-drop); Collections list + editor + smart rule builder with live preview; Brands/Tags/Attributes/Size guides simple CRUDs; Reviews moderation queue; Merchandising board.
DoD: Acceptance test "owner creates a product with 2 colours × 3 sizes, 4 images, 1 GLB, cost & price, puts it in a smart collection 'New' — appears on storefront in < 60 s (cache invalidation)".

#### M1.3 Inventory & purchasing (F-AD-50 – F-AD-53)
API `/admin/locations`, `/admin/inventory` (levels per variant×location, adjust with reason → `StockMovement`, transfer between locations, low-stock list), `/admin/inventory/movements`, `/admin/suppliers`, `/admin/purchase-orders` (draft → ordered → partially received → received; receiving updates on-hand and weighted-average cost), `/admin/stock-counts` (start session, enter counts, variance report, apply).
Admin pages: Stock overview (filters: low, out, location), Adjust/Transfer dialogs, Movements ledger, Suppliers, Purchase orders list + editor + receive flow, Stock count session.
DoD: receiving a PO for 20 units at 900 DA updates on-hand, movement ledger, and the variant's cost via weighted average; unit tests on the cost formula.

#### M1.4 Settings, Users, Audit (F-AD-91 – F-AD-93)
API `PATCH /admin/settings` (scoped, Zod per scope, secrets encrypted with `CREDENTIALS_KEY`), `/admin/users` (invite by e-mail → `StaffInvitation`, roles, deactivate, reset 2FA, sessions revoke), `/admin/roles` (permission matrix, custom roles), `/admin/audit` (list, entity filter, diff view), `/admin/backups` (trigger `pg_dump` job → storage, list, download signed URL).
Admin pages: Settings with sections Store / Localisation / Tax / Orders / Checkout / Loyalty / Inventory / Theme / Integrations / Notifications (templates editor per event × channel × locale with variable picker & preview) / Payments / Couriers / Backups / Maintenance. Users list + invite + role editor matrix. Audit log with before/after diff.
DoD: changing `checkout.free_shipping_threshold` reflects on storefront cart bar; audit row shows the diff; a Manager cannot open Finance.

**M1 exit:** nav entries Catalogue, Stock, Réglages, Journal are `ready`. README status updated.

---

### M2 — Storefront completion (browse → buy readiness)

- **Cart** (F-ST-40/41): `POST /cart` (token cookie), `PATCH /cart/items`, `DELETE /cart/items/:id`, `POST /cart/promo`, `GET /cart`; server-side price/stock revalidation; Zustand drawer with free-shipping progress, upsell rail; merge on login.
- **Wishlist**, **Recently viewed**, **Notify me** (`StockNotification`), **Reviews** read + submit (verified purchase check), **Newsletter** `POST /marketing/newsletter` (double opt-in optional), **Contact** `POST /contact`.
- **Account**: phone-OTP login UI, orders list/detail with timeline, addresses, wishlist, loyalty balance, delete account.
- **Public tracking** page `/track` (number + phone).
- **PWA** manifest + service worker (offline page, cache catalog images), **cookie consent**, **analytics events** `POST /events` (batched, no PII) + pixel injection from settings.
- **Home builder rendering** for every `HomeSection` type (featured collections, new arrivals, best sellers, promo banner + countdown, lookbook, brand story, testimonials, newsletter).
- Performance pass: Lighthouse mobile ≥ 85 on home/collection/PDP with seeded data; Draco GLB; `prefers-reduced-motion`.
DoD: Playwright e2e "guest adds 2 variants, applies promo, sees correct totals in drawer" (checkout itself lands in M3).

---

### M3 — Checkout, Promo engine, Orders module, Notifications

#### M3.1 Promo engine (F-AD-20/21) — pure domain package `apps/api/src/modules/promotions/engine/`
Input: cart lines (variant, qty, unit price, product/category/collection ids), customer (group, order count), wilaya, code(s). Output: applied promotions, per-line discounts, order-level discount, free shipping flag, rejection codes from `PROMO_REJECTIONS`. Supports all types in `promotionInputSchema` (percent, fixed, free shipping, BxGy, bundle, tiered, first order), scopes, limits (total/per customer via `PromoUsage`), stacking with priority, schedule, bulk unique codes. **≥ 90 % coverage, table-driven tests.**
API `/admin/promotions` CRUD + `POST /:id/codes/generate` + `GET /:id/performance`; flash sales set badges/countdown on storefront via `settings.home`.
Admin: Promotions list (active/scheduled/expired), editor with condition builder & live "simulate on cart" panel, bulk codes download.

#### M3.2 Checkout & order creation (F-ST-42 – F-ST-46, Section 7)
`POST /orders` (guest COD; `checkoutSchema`; idempotent; risk checks: rate limit per phone/IP, duplicate window, blacklist, max/day, captcha after N, optional OTP) → creates Customer (upsert by phone), Order + items snapshot (price, cost), reserves stock, applies promo usage, computes totals (`@jecks/shared/money`), emits `order.created` (SSE + notification job), returns number + tracking URL. `GET /orders/track`. Abandoned-cart ping. Storefront: one-page checkout UI, confirmation page, tracking page. Online payment: `PaymentProvider` interface + `CodProvider` (default) + `ChargilyProvider` scaffold (create checkout, webhook verify) selectable in Settings › Payments.

#### M3.3 Order state machine & admin orders (F-AD-30 – F-AD-36)
`OrderService.transition(orderId, to, actor, reason)` implements exactly the graph of PRD v1 Section 7 with side effects: reserve/deduct/restock per `orders.stock_deduction_moment`, payment status, notifications, `OrderEvent`. Unit tests for every legal and illegal edge.
API `/admin/orders` (list with status tabs & counters, filters per F-AD-30, bulk confirm/print/assign/export), `GET /:id`, `PATCH /:id` (edit items/address before PACKED with repricing), `POST /:id/transition`, `/:id/call-logs`, `/:id/notes`, `/:id/tags`, `POST /admin/orders/manual`, `/:id/returns`, `/:id/refunds`, `GET /:id/documents/{invoice,packing-slip,label}.pdf` (Puppeteer or `pdfkit`; label A6 with Code128/QR), `POST /admin/orders/documents/batch`.
Admin: Orders list with tabs; **Order detail** (customer card with tel:/wa.me links, editable items, totals, delivery panel placeholder for M4, timeline, call log with outcomes & callback scheduling, notes, tags, risk flags), Manual order creation (customer combobox, product search, address), Returns dialog, bulk print.

#### M3.4 Notifications (6.1)
`Notifier` interface + adapters: `LogNotifier` (default), `SmtpNotifier` (Mailpit in dev), `TwilioSmsNotifier`, generic `HttpSmsNotifier` (configurable URL/template for Algerian gateways), `WhatsAppCloudNotifier`, `TelegramNotifier` (owner alerts), `InAppNotifier`. Template rendering (Handlebars-style variables, per locale) from `NotificationTemplate`. Worker queue `notifications` with retries and dedupe. Events wired: order placed/confirmed/shipped/out for delivery/delivered/failed/cancelled, back in stock, abandoned cart, review request (N days after delivered), low stock (owner), new order (owner). Replace `TODO(M3)` in `auth.service.ts` (OTP goes through SMS notifier).
Admin: Notifications center (in-app list, mark read), Settings › Notifications templates editor with test-send.

**M3 exit:** Acceptance criterion 1 of PRD v1 passes end-to-end (Playwright); nav entries Commandes, Promotions ready.

---

### M4 — Delivery & cash (the "delivery truck" module)

- **Zones & rates** (F-AD-60): `/admin/shipping/zones|rates` CRUD, matrix editor page (wilaya × type × courier), bulk import, free-shipping rule; `GET /shipping/quote` reads it (already exists—verify).
- **Couriers** (F-AD-61): `CourierProvider` interface (`createShipment`, `label`, `track`, `cancel`, `parseWebhook`), `ManualCourier` (CSV export/import of tracking), adapters `YalidineCourier`, `ZrExpressCourier`, `MaystroCourier`, `EmsCourier` with real request builders against their documented APIs and unit tests on stubbed HTTP; credentials in `CourierCredential` (encrypted), configurable in Settings › Couriers; `POST /webhooks/couriers/:provider` (verify signature, idempotent, map to `ShipmentEvent` + order transitions); worker `courier.sync` polling for adapters without webhooks.
- **Shipments**: `POST /admin/orders/:id/ship` (courier or own fleet), label generation, `Shipment` lifecycle, attempts, cost.
- **Fleet** (F-AD-62/63): `/admin/vehicles`, `/admin/drivers`, `/admin/delivery-runs` (create for date+driver+vehicle, assign orders, reorder stops, nearest-neighbour auto-order using commune centroids from a bundled dataset, manifest PDF), `PATCH /admin/delivery-runs/:id/stops/:stopId` (delivered with cash amount / failed with reason / rescheduled, proof photo upload), status DeliveryRunStatus.
- **Driver mobile view**: route `/driver` in admin (role Driver, permission `delivery.own_runs`): today's run, stop cards, call/WhatsApp/Waze/Google Maps deep links, big Delivered/Failed buttons, cash amount input, camera capture, offline queue via IndexedDB + background sync (MAY but attempt).
- **Cash & settlements** (F-AD-64): `CodCollection` per stop/shipment, `/admin/cash/daily` (expected vs collected per driver/courier), `/admin/settlements` (generate for courier & period from delivered shipments, lines, fees, mark paid, variance), payment ledger entries.
- **Delivery analytics** (F-AD-65) endpoint + page.
Admin pages: Livraison › Expéditions, Transporteurs, Tarifs, Flotte (véhicules, chauffeurs), Tournées (planning board by day with drag-drop of orders to runs + map with Leaflet/OSM), Caisse COD, Règlements transporteurs, Analytics.
DoD: Acceptance criterion 2 & 4 pass; a Driver login sees only their run.

---

### M5 — Finance, Analytics, Customers, Loyalty

- **Expenses** (F-AD-71): `/admin/finance/expenses` + categories + recurring generator (worker monthly), attachments via media.
- **Ad spend** (F-AD-73): manual entries per platform/day; ROAS & cost per order in reports.
- **Payments ledger** (F-AD-72): every COD collection, online payment, refund, courier settlement, expense as `LedgerEntry`; cash drawer balance; reconciliation view.
- **P&L** (F-AD-70): `GET /admin/finance/pnl?from&to&groupBy=day|week|month|product|category|collection|wilaya|channel|courier` computing Revenue − COGS − shipping cost − discounts − payment fees − returns − expenses = net profit, from orders (delivered & paid definition configurable) with `daily_stats` extended columns; period compare; export.
- **Reports library** (F-AD-80/81): endpoints under `/admin/reports/*` for every report listed in PRD v1 5.9 (sales by product/variant/category/collection/period/wilaya/courier/source/agent; inventory valuation & ageing; cohorts & retention; promo performance; zero-result searches; funnel; stock-out lost sales); each returns `{ series, table }`; export via `ReportExport` job; scheduled e-mail MAY.
- **Dashboard v2** (F-AD-01 – F-AD-04): all tiles/charts of PRD v1 incl. wilaya choropleth, hourly heatmap, funnel; "needs attention" now real (pending confirmations, failed deliveries, low stock, pending reviews, unread messages, promos ending); activity feed from audit log.
- **Customers** (F-AD-40 – F-AD-42): `/admin/customers` list with segments (computed nightly by worker), profile (LTV, delivery success rate, orders, addresses, notes, tags, loyalty ledger, consents), blacklist, merge duplicates, groups.
- **Loyalty** (6.5): earn on DELIVERED (worker), redeem at checkout (M3 hook), manual adjust, ledger.
Admin pages: Finances (P&L, Dépenses, Publicité, Paiements/Caisse), Rapports (library with left index), Clients (list, profile, groupes), Dashboard v2.
DoD: Acceptance criteria 2 (profit part) & 5 pass; P&L unit tests ≥ 90 % on the calculation service; every report renders with seed data.

---

### M6 — Marketing, Content, Polish

- **Home builder** (F-AD-23): `/admin/content/home` sections CRUD + reorder + preview iframe of storefront with `?preview=token`.
- **Banners & announcements** (F-AD-22), **Pages CMS** editor (TipTap, slug, SEO, publish), **Menus** editor (header/footer trees), **Redirects**, **Theme** (logo/favicon/colors within tokens), **Media library** links.
- **Marketing**: newsletter subscribers list/export + Brevo adapter send (MAY), **abandoned carts** page with call/WhatsApp links & recovery code, **affiliates/influencer codes** with attributed sales, **flash sale** campaign page, **gift cards** (MAY).
- **Reviews** storefront request e-mail/SMS after delivery, moderation already in M1.
- **Storefront polish**: accessibility audit (axe, keyboard, contrast of brass on dark), motion polish (card tilt, add-to-cart fly), real GLB hero replacing procedural geometry (D24) uploaded via media library and selectable in Settings › Theme.
Admin pages: Contenu (Accueil, Bannières, Annonces, Pages, Menus, Redirections, Thème), Marketing (Newsletter, Paniers abandonnés, Affiliés, Ventes flash).
DoD: All 12 nav entries `ready`; `PlannedModule` deleted; PRD v1 acceptance criteria 1–7 pass except infra items of M7.

---

### M7 — Hardening, tests, launch

- Playwright suite: guest COD checkout; admin creates product → storefront; confirm → pack → ship (own fleet) → driver delivers → P&L shows profit; promo application; failed delivery → reschedule → return → restock; role isolation (agent no finance, driver own run only); CSV import of products.
- Load test (k6): 200 concurrent catalog reads p95 < 200 ms with Redis cache (add catalog GET caching + invalidation on write if not present).
- Security pass: rate limits on auth/checkout/webhooks, Helmet, CSRF on cookie routes, signed URLs for documents, dependency audit, secrets scan, OWASP checklist in `docs/SECURITY.md`.
- Ops: nightly `pg_dump` job to storage with retention, restore drill documented, Bull Board mounted under admin auth, `/metrics` endpoint, Sentry adapter behind env flag, deploy script for single VPS, `docs/RUNBOOK.md` updated.
- Documentation: `docs/API.md` regenerated from Swagger, `docs/DECISIONS.md` complete, README status = "v1 complete".
DoD: `docker compose -f infra/docker/docker-compose.prod.yml up` on a clean VM serves storefront + admin + API with seed; CI green incl. e2e job.

---

## 4. Admin module map — target state (what "finished" looks like)

| Nav | Routes (admin SPA) | Backing API | Milestone |
|---|---|---|---|
| Tableau de bord | `/` | `/admin/dashboard/*`, `/admin/events` | M1.0 → M5 |
| Commandes | `/orders`, `/orders/:id`, `/orders/new`, `/orders/returns` | `/admin/orders/*` | M3 |
| Catalogue | `/catalog/products[/:id]`, `/catalog/categories`, `/catalog/collections[/:id]`, `/catalog/brands`, `/catalog/attributes`, `/catalog/size-guides`, `/catalog/reviews`, `/catalog/merchandising`, `/catalog/media` | `/admin/products…`, `/admin/media` | M1 |
| Stock | `/inventory`, `/inventory/movements`, `/inventory/suppliers`, `/inventory/purchase-orders[/:id]`, `/inventory/counts[/:id]`, `/inventory/locations` | `/admin/inventory…` | M1 |
| Clients | `/customers[/:id]`, `/customers/groups` | `/admin/customers…` | M5 |
| Livraison | `/delivery/shipments`, `/delivery/couriers`, `/delivery/rates`, `/delivery/fleet`, `/delivery/runs[/:id]`, `/delivery/cash`, `/delivery/settlements`, `/delivery/analytics`, `/driver` | `/admin/shipping…`, `/admin/delivery-runs…` | M4 |
| Promotions | `/promotions[/:id]`, `/promotions/flash-sales`, `/promotions/affiliates` | `/admin/promotions…` | M3, M6 |
| Finances | `/finance/pnl`, `/finance/expenses`, `/finance/ads`, `/finance/ledger` | `/admin/finance…` | M5 |
| Rapports | `/reports/:key` | `/admin/reports/*` | M5 |
| Contenu | `/content/home`, `/content/pages`, `/content/menus`, `/content/banners`, `/content/announcements`, `/content/redirects`, `/content/theme` | `/admin/content/*` | M6 |
| Marketing | `/marketing/newsletter`, `/marketing/abandoned-carts`, `/marketing/notifications` | `/admin/marketing/*` | M3, M6 |
| Journal | `/audit` | `/admin/audit` | M1 |
| Réglages | `/settings/:section`, `/settings/users`, `/settings/roles`, `/settings/backups` | `/admin/settings`, `/admin/users`, `/admin/roles`, `/admin/backups` | M1 |

(Add "Marketing" as a 13th nav entry with permission `marketing.read` — the permission already exists.)

---

## 5. Testing contract per milestone

| Layer | Requirement |
|---|---|
| Unit (Vitest) | Promo engine, order state machine, totals, stock ledger & weighted cost, P&L, settlement math, notification templating, courier adapters (stubbed HTTP), risk scoring — **≥ 90 % line coverage on these directories**, enforced in `vitest.config.ts` thresholds |
| Integration (Testcontainers) | Every `/admin/*` controller: happy path + permission denial + validation error; checkout; webhooks idempotency |
| E2E (Playwright, M7 but scaffold in M3) | Flows listed in M7 |
| Storefront | Vitest + Testing Library for cart store, checkout form validation, dictionary completeness (all keys in fr/ar/en) |
| CI | Add `e2e` job with docker services; fail on coverage threshold; fail if `grep TODO(M` finds anything after M7 |

---

## 6. Definition of "no mock" — final checklist (run before declaring v1 complete)

- [ ] `navigation.ts` has no `status: 'planned'`; `PlannedModule` removed.
- [ ] Every nav route renders data from the API with seed; opening each page with the network tab shows real `/api/v1/admin/*` calls.
- [ ] `docs/API.md` "Planned surface" section removed; Swagger `/docs` lists all routes.
- [ ] `grep -rn "TODO(M" apps packages` → empty.
- [ ] Worker: `media.process`, `notifications`, `courier.sync`, `reports.export`, `backup`, `loyalty.accrue`, `segments.rebuild`, `expenses.recurring` all have processors and tests.
- [ ] Settings › Notifications / Payments / Couriers let the owner pick an adapter and test it.
- [ ] Seed produces orders in every status, shipments with both courier and own fleet, settlements, expenses, ad spend, reviews, abandoned carts, so every chart and list is non-empty.
- [ ] PRD v1 acceptance criteria 1–7 automated where possible and documented in `docs/ACCEPTANCE.md` with evidence (screenshots/recordings).

---

## Appendix A — Kickoff prompt for Claude Code (Opus)

> Read `docs/PRD.md` (functional contract) and `docs/PRD-COMPLETION.md` (this plan, reflecting the audited codebase at commit 8012b17). Start at **M1.0** (Section 2: `@jecks/ui` components, admin list/form framework, SSE, command palette, audit interceptor, integration test harness). Then proceed **M1.1 → M1.4**, then M2 … M7, strictly in order. Obey the anti-mock rules in Section 0: nothing in the admin may be a placeholder, every screen is backed by a real endpoint, every provider ships with a working default adapter and tests. After each sub-milestone run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, extend the seed so the new screens show data, update README status, `docs/API.md`, `docs/DECISIONS.md`, and report: done / pending / deviations. Do not skip tests for the promo engine, order state machine, stock ledger, P&L and settlements. Do not start a new milestone while the previous one has failing checks or a remaining `TODO(Mx)` for that milestone.
