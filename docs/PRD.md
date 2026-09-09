# Jeck's — Caps E-Commerce Platform
## Product Requirements Document (PRD)

| | |
|---|---|
| **Product** | Jeck's — online store + back-office for a caps / headwear brand |
| **Version** | 1.0 (implementation-ready) |
| **Date** | 2026-09-09 |
| **Owner** | Maher (product owner / lead dev) |
| **Audience** | Claude Code (Opus) implementation agent, contributors |
| **Stack (fixed)** | React 18 + TypeScript · Node.js + TypeScript · PostgreSQL |
| **Reference sites** | goorin.com, goorinshop.de (visual & UX inspiration only — no copying of assets, copy, or branding) |

---

## 0. How to use this document (instructions for the implementing agent)

1. Read the whole PRD once before writing code. Sections 4–9 are the functional contract; Section 10 is the technical contract; Section 13 is the delivery order.
2. Build in the **milestone order of Section 13**. Each milestone must end with: passing tests, a seeded demo database, and a working `docker compose up`.
3. Where this document says **MUST**, it is a hard requirement. **SHOULD** is strongly preferred. **MAY** is optional / nice-to-have.
4. Where a detail is not specified, choose the option that is (a) simplest to operate for a solo owner, (b) conventional for the stack, (c) easily changed later. Document the choice in `docs/DECISIONS.md`.
5. Do not introduce a paid third-party service without a free/self-hosted fallback (see Section 10.9).
6. Ship everything in a **monorepo** (Section 10.1). Keep the domain logic in the API package, never duplicated in the frontends.

---

## 1. Vision & Goals

### 1.1 Vision
Jeck's is a specialist caps brand. The platform must make Jeck's feel like a **premium, modern headwear house** — bold, tactile, "3D" product presentation — while giving the owner a **single back-office that runs the entire business**: catalog, stock, promotions, orders, deliveries, customers, finances, and analytics.

### 1.2 Business goals
- Sell caps online with the lowest possible friction for the Algerian market (cash on delivery, wilaya-based shipping, phone-first checkout) while remaining ready for international sales (multi-currency, card payments) later.
- Give the owner full visibility on **revenue, cost, margin and net profit** per product, per period, per channel.
- Run delivery operations (own trucks/drivers and third-party couriers) from the same panel.
- Reduce manual work: automatic stock deductions, low-stock alerts, order status notifications, promo scheduling.

### 1.3 Success metrics (KPIs)
| KPI | Target (6 months post-launch) |
|---|---|
| Storefront Lighthouse performance (mobile) | ≥ 85 |
| Checkout completion rate (cart → confirmed order) | ≥ 35 % |
| Order confirmation time (order → confirmed by staff) | ≤ 2 h median |
| Delivery success rate (delivered / shipped) | ≥ 85 % |
| Owner time spent per order in admin | ≤ 90 s |
| Admin dashboard load time | ≤ 1.5 s |

### 1.4 Out of scope for v1
Native mobile apps, marketplace/multi-vendor, POS hardware integration, ERP accounting export beyond CSV/Excel, AR try-on (listed as a v2 idea in Section 14).

---

## 2. Users & Personas

| Persona | Description | Primary needs |
|---|---|---|
| **Shopper (guest)** | Mostly mobile (Android), Arabic/French speaking, discovers via Instagram/TikTok/Facebook ads | Fast browsing, sizing confidence, pay on delivery, order by phone number without creating an account |
| **Shopper (registered)** | Repeat buyer | Order history, wishlist, saved address, loyalty/promo codes, tracking |
| **Owner** | Runs the business, non-technical | Everything: catalog, promos, orders, deliveries, money, stats, settings |
| **Manager** | Trusted staff | Same as owner minus finance/settings/user management |
| **Order agent (call center)** | Confirms COD orders by phone | Order queue, call notes, status updates, edit order |
| **Warehouse / packer** | Prepares parcels | Pick list, mark packed, print labels |
| **Driver** | Own delivery fleet | Mobile-friendly route list, mark delivered / failed, collect cash |
| **Courier partner** | Third-party (e.g. Yalidine, ZR Express, Maystro, EMS) | Receives shipments via API or CSV, returns tracking status |

---

## 3. Market & Localization Requirements

- **Primary market: Algeria.** Currency **DZD** (display "DA"). 58 wilayas + communes list must be seeded. Shipping fees differ by wilaya and by delivery type (home vs. stop-desk/pickup point).
- **Payment**: Cash on Delivery (COD) is the default and MUST work fully offline from any payment gateway. Online payment (CIB/Edahabia via a local PSP such as SATIM/Chargily; Stripe/PayPal for international) is a pluggable module behind a `PaymentProvider` interface.
- **Languages**: Storefront MUST support **French, Arabic (RTL), English** via i18n with per-product translated fields. Admin panel defaults to French/English (RTL support is required in the design system but Arabic admin copy MAY be v2).
- **Phone-first**: Phone number is the primary customer identifier in checkout (E.164 normalized, Algerian format validation +213 / 05xx/06xx/07xx).
- **Time zone**: Africa/Algiers for all reporting; store all timestamps in UTC.
- **Tax**: Prices are tax-inclusive by default; configurable VAT rate (default 19 %) used only for reporting.

---

## 4. Storefront — Functional Requirements (Client Website)

### 4.1 Global
- **F-ST-01** Responsive, mobile-first, PWA-installable (manifest + service worker; offline page).
- **F-ST-02** Header: logo, mega-menu (Caps › New, Truckers, Snapbacks, Fitted, Dad caps, 5-panel, Bucket, Beanies, Kids, Women; Collections; Sale/Last Chance; About), search, language/currency switcher, wishlist, cart drawer, account.
- **F-ST-03** Announcement bar (admin-managed, schedulable, e.g. "Livraison gratuite dès 6000 DA").
- **F-ST-04** Footer: sitemap, support (shipping, returns, FAQ, size guide, contact), social links, newsletter signup, legal pages (CMS-managed).
- **F-ST-05** SEO: SSR or pre-rendering for product/collection/CMS pages, canonical URLs, Open Graph, JSON-LD Product/Breadcrumb/Organization, sitemap.xml, robots.txt, hreflang.
- **F-ST-06** Analytics hooks: GA4 / Meta Pixel / TikTok Pixel IDs configurable from admin; server-side events for purchase.
- **F-ST-07** Cookie consent banner (configurable).

### 4.2 Home page
- **F-ST-10** Hero: full-bleed video or image carousel with **3D animated cap** (see Section 9) and CTA(s) — all managed from admin "Home builder".
- **F-ST-11** Configurable sections (drag-to-reorder in admin): Featured collections grid, New arrivals carousel, Best sellers, Promo banner with countdown, Lookbook/Instagram feed, Brand story, Testimonials/reviews, Newsletter.
- **F-ST-12** Countdown timer component for drops/sales (admin sets start/end).

### 4.3 Catalog / Collection pages
- **F-ST-20** Collection page with hero, description, product grid (2 cols mobile / 3–4 desktop), infinite scroll or pagination (configurable).
- **F-ST-21** Filters: category, style, color, size, price range, material, patch/motif/theme, availability, on-sale. Filters are URL-persisted and multi-select. Filter facet counts displayed.
- **F-ST-22** Sort: relevance, best selling, newest, price ↑/↓, name A–Z/Z–A, biggest discount.
- **F-ST-23** Product card: primary image with hover swap to secondary image (or short 3D turn-around on hover), badges (NEW, -X %, SOLD OUT, LIMITED, BEST SELLER), style label, name, price with struck-through compare price, color swatches (click swaps image), quick-add / quick-view.
- **F-ST-24** "Last Chance / Sale" collection auto-populated by rule (products with active discount or tagged `clearance`).
- **F-ST-25** Search: instant search with suggestions (products, collections, pages), typo-tolerant (Postgres `pg_trgm` + full-text; Meilisearch MAY be added later behind an interface). Search results page with the same filters.

### 4.4 Product detail page (PDP)
- **F-ST-30** Media gallery: images (zoom, swipe), video, and **interactive 3D viewer** (GLB/GLTF via `<model-viewer>` or React Three Fiber) with 360° rotate, zoom, and optional AR quick-look on supported devices. Falls back to images if no 3D asset.
- **F-ST-31** Variant selection: color (swatches with images), size (S/M/L, One-size, adjustable, fitted 6⅞–8, kids). Size guide modal (admin-editable, per category). Out-of-stock variants shown disabled with "Notify me".
- **F-ST-32** Price, compare-at price, discount %, installment/promo messaging, stock indicator ("Only 3 left"), delivery ETA by wilaya (select wilaya → shows fee & ETA).
- **F-ST-33** Description (rich text), attributes table (material, closure, crown, brim, fit, care), SKU.
- **F-ST-34** Add to cart, Buy now (jumps to checkout), Add to wishlist, Share.
- **F-ST-35** Reviews & ratings (verified-purchase badge, photos, admin moderation). Q&A MAY be v2.
- **F-ST-36** Cross-sell: "Complete the look", "You may also like", "Recently viewed".
- **F-ST-37** Bundles: display bundle products ("Pack 3 caps -20 %") with component selection.

### 4.5 Cart & Checkout
- **F-ST-40** Slide-out cart drawer: line items with variant, qty stepper, remove, subtotal, free-shipping progress bar, promo code field, upsell strip.
- **F-ST-41** Cart persists for guests (localStorage + server cart token) and merges on login.
- **F-ST-42** **One-page checkout optimized for COD**: full name, phone (required, validated), second phone (optional), wilaya → commune (dependent selects), delivery type (home / stop-desk pickup point with point picker), address, note; shipping fee and total update live; payment method selector (COD default; online payment when enabled); order summary; place order. Guest checkout MUST NOT require an account or e-mail.
- **F-ST-43** Promo code validation with clear error reasons (expired, min amount, usage limit, not eligible).
- **F-ST-44** Anti-fraud for COD: rate limiting per phone/IP, duplicate-order detection within X minutes, optional OTP by SMS (pluggable), blacklist check, CAPTCHA (Turnstile/hCaptcha) after N attempts.
- **F-ST-45** Order confirmation page + SMS/e-mail/WhatsApp confirmation (pluggable notifiers) with tracking link.
- **F-ST-46** Abandoned cart capture (phone entered but not completed) → visible in admin for follow-up.

### 4.6 Account
- **F-ST-50** Auth: phone + OTP (preferred) and e-mail + password; social login (Google) MAY.
- **F-ST-51** Orders list & detail with timeline tracking (Placed → Confirmed → Packed → Shipped → Out for delivery → Delivered / Failed / Returned / Cancelled).
- **F-ST-52** Public order tracking page by order number + phone (no login).
- **F-ST-53** Addresses, wishlist, reviews written, loyalty points balance (Section 6.5), notification preferences, delete account (GDPR-style).

### 4.7 Content pages
- **F-ST-60** CMS pages (About, Shipping & Returns, FAQ, Size guide, Contact, Legal) with rich-text editor and slug management; blog/lookbook posts MAY.
- **F-ST-61** Contact form → admin inbox + e-mail.
- **F-ST-62** Store locator / stockists map MAY (v2).

---

## 5. Admin Panel — Functional Requirements (Owner Back-Office)

The admin is a separate React SPA at `admin.<domain>` (or `/admin`). Every module below is a left-nav entry. All lists MUST support: server-side pagination, column sorting, multi-filter, saved views, full-text search, bulk actions, CSV/Excel export, and column visibility toggles.

### 5.1 Dashboard (home)
- **F-AD-01** KPI tiles with period selector (today, yesterday, 7d, 30d, MTD, QTD, YTD, custom, compare to previous period): Orders, Revenue, **Gross profit**, **Net profit**, Avg order value, Conversion rate, Return/failed-delivery rate, Pending confirmations, Low-stock SKUs.
- **F-AD-02** Charts: revenue & profit over time, orders by status funnel, top products, sales by wilaya (map), sales by channel/source (UTM), hourly heatmap.
- **F-AD-03** "Needs attention" widgets: orders awaiting confirmation, failed deliveries to re-schedule, low/out-of-stock, pending reviews, unread messages, promos ending soon.
- **F-AD-04** Activity feed (audit log stream).

### 5.2 Catalog management
- **F-AD-10** **Products CRUD** with a rich product editor:
  - Basics: name (multi-language), slug, brand, category (tree), collections (many), tags, status (draft / active / archived), visibility, publish schedule.
  - Descriptions: rich text (multi-language), SEO title/description, attributes (structured key/values: material, closure, crown, brim, fit, care, origin…).
  - **Media**: multi-upload with drag-and-drop reordering, alt text, per-variant assignment, image cropping/auto-resize (WebP/AVIF generation), video URL/upload, **3D model upload (GLB)** with preview, background-removal MAY.
  - **Variants**: option builder (Color × Size → auto-generate variants), per variant: SKU, barcode, price, compare-at price, **cost price**, weight, stock per location, images, status.
  - Pricing: price, compare-at, cost, margin % auto-computed; scheduled price changes.
  - Inventory: track quantity per warehouse/location, allow backorder toggle, low-stock threshold.
  - Shipping: weight/dimensions, shipping class.
  - Related products, bundle composition, "notify me" subscribers count.
  - Duplicate product, quick edit inline in list, bulk edit (price, status, collection, tags), bulk import/export via CSV/Excel with template & validation report.
- **F-AD-11** Categories (tree, drag to reorder, image, SEO), Collections (manual or **rule-based smart collections**: tag = X, price < Y, discount > 0…), Brands, Attributes & option sets, Size guides, Tags.
- **F-AD-12** Reviews moderation (approve/reject/reply), Q&A moderation MAY.
- **F-AD-13** Search synonyms & merchandising: pin products to top of a collection, hide, boost.

### 5.3 Promotions & marketing
- **F-AD-20** **Promo/discount engine (CRUD)** supporting: percentage off, fixed amount off, free shipping, buy X get Y, bundle price, tiered (spend ≥ N → X %), first-order, per-collection/category/product/variant scope, customer-group scope, wilaya scope, min subtotal/qty, usage limits (total, per customer), start/end schedule, stackable flag & priority, automatic (no code) vs. code-based, bulk unique-code generation (e.g. 500 one-time codes for influencers).
- **F-AD-21** Flash sales / countdown campaigns that also drive the storefront countdown and badges.
- **F-AD-22** Banners & announcement bar manager (placement, schedule, link, A/B variant MAY).
- **F-AD-23** Home page builder (sections list, reorder, content, preview).
- **F-AD-24** Newsletter subscribers list + export; campaign send MAY via provider plugin (Brevo/Mailchimp).
- **F-AD-25** Abandoned carts list with one-click "call" / WhatsApp deep link and recovery code.
- **F-AD-26** Gift cards MAY (v2). Loyalty program config (points per DA, redemption rules) — see 6.5.
- **F-AD-27** Influencer / affiliate codes with attributed sales report.

### 5.4 Orders management
- **F-AD-30** Orders list with status tabs & counters (New, To confirm, Confirmed, Packed, Shipped, Out for delivery, Delivered, Failed, Returned, Cancelled, Refunded), filters (date, wilaya, courier, payment, source, agent, tag), bulk actions (confirm, print labels, assign courier, export).
- **F-AD-31** Order detail: customer card (phone with click-to-call & WhatsApp), items (editable before shipping: qty, variant swap, add item, discount override), pricing breakdown, shipping info & fee, payment status, **delivery panel** (courier, tracking, driver, attempts), timeline/audit, internal notes, call log (outcome: confirmed / no answer / cancelled / call back at), tags, risk score.
- **F-AD-32** Manual order creation (phone/Instagram orders) with customer lookup/creation.
- **F-AD-33** Status transitions enforced by a state machine with side-effects: stock reservation on placement, deduction on confirmation (configurable), restock on cancel/return, notifications on each change, COD cash expected on "Out for delivery", cash collected on "Delivered".
- **F-AD-34** Returns & exchanges: create return, reason, condition, restock decision, refund record.
- **F-AD-35** Documents: invoice/receipt PDF, packing slip, shipping label (A6 with barcode/QR), bulk print.
- **F-AD-36** Fraud/blacklist: block phone numbers, flag repeated failed COD deliveries.

### 5.5 Customers
- **F-AD-40** Customer list (segments: new, returning, VIP, at-risk, blacklisted), profile with lifetime value, orders, delivery success rate, addresses, notes, tags, loyalty balance, consent flags.
- **F-AD-41** Customer groups (wholesale/VIP) with group pricing MAY.
- **F-AD-42** Merge duplicate customers (same phone).

### 5.6 Inventory & suppliers
- **F-AD-50** Locations/warehouses; stock per variant per location; stock movements ledger (reason: purchase, sale, return, adjustment, transfer, damaged).
- **F-AD-51** Purchase orders to suppliers (draft → ordered → received; partial receive; updates cost price with weighted average).
- **F-AD-52** Low-stock alerts (dashboard + e-mail/telegram notifier), reorder points, stock-take (count session with variance report).
- **F-AD-53** Suppliers CRUD with contact and product mapping.

### 5.7 Delivery & logistics ("Delivery truck" module)
- **F-AD-60** Shipping zones & rates: per wilaya (58 seeded) × delivery type (home / stop-desk) × courier; free-shipping threshold; weight-based extras.
- **F-AD-61** **Couriers**: CRUD for third-party couriers with a `CourierProvider` adapter interface (create shipment, print label, fetch tracking, cancel). Implement a **manual/CSV courier** first; provide adapter scaffolds for Yalidine, ZR Express, Maystro, EMS (config via API keys in settings). Webhook endpoint for tracking updates.
- **F-AD-62** **Own fleet**: Vehicles (trucks/motorbikes: plate, capacity, status), Drivers (user with `driver` role, phone, zone), **Delivery runs/routes**: create a run for a date + driver + vehicle, assign orders, ordered stop list, optional map view & optimized ordering (nearest-neighbour heuristic, no paid API required), print manifest.
- **F-AD-63** **Driver mobile view** (responsive route in the admin app, role-limited): today's stops, call customer, navigate (Google/Waze deep link), mark Delivered (cash collected amount), Failed (reason: no answer / refused / wrong address / reschedule), capture photo/signature MAY, offline queue MAY.
- **F-AD-64** **Cash reconciliation**: COD cash expected vs. collected per driver/courier per day; courier settlement statements (amount due from courier, fees deducted, paid on date) with difference tracking.
- **F-AD-65** Delivery analytics: success rate by wilaya/courier/driver, avg delivery time, failed reasons breakdown, cost per delivery.

### 5.8 Finance & profit
- **F-AD-70** **Profit & loss view**: Revenue (delivered/paid orders), − COGS (cost price of items sold), − shipping cost paid to couriers/drivers, − promo discounts, − payment fees, − returns, − **expenses** = Net profit. Selectable period, per product/category/collection/wilaya/channel breakdown.
- **F-AD-71** Expenses module: CRUD (rent, ads, salaries, packaging, fuel, misc), categories, recurring expenses, attachments.
- **F-AD-72** Payments ledger: every cash/online payment, refunds, courier settlements; cash drawer balance.
- **F-AD-73** Ad spend tracking (manual entry per platform/day; API import MAY) → ROAS and cost per order.
- **F-AD-74** Exports: CSV/Excel of all reports; accountant export (sales journal).

### 5.9 Analytics & reports
- **F-AD-80** Reports library: Sales by product/variant/category/collection, by period, by wilaya, by courier, by source/UTM, by agent; Inventory valuation & ageing; Customer cohorts & retention; Promo performance (uses, revenue, discount cost); Search terms with zero results; Product views → add-to-cart → purchase funnel; Stock-out lost sales estimate.
- **F-AD-81** Every report: chart + table, period compare, export, schedule e-mail MAY.
- **F-AD-82** Storefront event tracking (page view, product view, add to cart, checkout start, purchase) stored server-side (privacy-friendly, no PII beyond customer id) to power funnels.

### 5.10 Content & site settings
- **F-AD-90** Pages CMS, navigation menus editor (header/footer), media library (folders, search, usage), SEO defaults, redirects manager (301), theme settings (logo, favicon, colors, fonts within design-system tokens), social links, legal pages.
- **F-AD-91** **Settings**: store info (name, address, phones, e-mail, RC/NIF for invoices), currencies & display, languages, tax, order settings (auto-confirm rules, stock deduction moment, order number format), checkout fields toggles, payment providers, courier providers, notification templates (SMS/e-mail/WhatsApp, per language, variables), integrations (pixels, Google Merchant feed, Facebook catalog feed URL), backups (trigger/download DB dump), maintenance mode.
- **F-AD-92** **Users & roles**: RBAC with roles Owner, Manager, Order agent, Warehouse, Driver, Marketing, Accountant; fine-grained permissions matrix; 2FA (TOTP) for staff; session management; invitation flow.
- **F-AD-93** Audit log: who changed what, before/after diff, filter by entity/user/date.
- **F-AD-94** Notifications center in admin (in-app), Telegram/e-mail notifiers for key events (new order, failed delivery, low stock).

---

## 6. Cross-cutting Features

### 6.1 Notifications (pluggable `Notifier` interface)
Channels: SMS (Algerian gateway adapter + Twilio adapter), E-mail (SMTP/Brevo), WhatsApp (Cloud API adapter), Telegram (owner alerts), in-app. Templates editable in admin with variables `{{order_number}}`, `{{customer_name}}`, `{{tracking_url}}`… Events: order placed, confirmed, shipped, out for delivery, delivered, failed, cancelled, back-in-stock, abandoned cart, review request.

### 6.2 Search
Postgres full-text (`tsvector`, per-language config) + `pg_trgm` for typo tolerance, weighted (name > tags > description). Interface allows swapping to Meilisearch.

### 6.3 Media pipeline
Upload → validate → store (local disk in dev, S3-compatible in prod: MinIO/Cloudflare R2) → generate responsive WebP/AVIF sizes (sharp) → CDN URL. 3D: accept GLB ≤ 15 MB, generate poster image.

### 6.4 Internationalization
`i18next` on both frontends; translatable DB fields stored as JSONB `{ "fr": "...", "ar": "...", "en": "..." }` with fallback chain. RTL layout via logical CSS properties.

### 6.5 Loyalty (simple, v1)
Points earned per DA spent on delivered orders (configurable), redeemable as discount at checkout (configurable rate, max % of order). Admin can adjust manually.

### 6.6 Accessibility
WCAG 2.1 AA on storefront: keyboard navigation, focus states, alt text, contrast (check gold-on-dark), reduced-motion respect for 3D/animations.

---

## 7. Order Lifecycle (state machine)

```
PENDING ──confirm──▶ CONFIRMED ──pack──▶ PACKED ──ship──▶ SHIPPED ──▶ OUT_FOR_DELIVERY ──▶ DELIVERED
   │                    │                   │                │                 │
   └──cancel──▶ CANCELLED (from PENDING/CONFIRMED/PACKED)     └─────fail──────▶ FAILED ──▶ (retry: OUT_FOR_DELIVERY | RETURNED)
DELIVERED ──return──▶ RETURN_REQUESTED ──▶ RETURNED ──▶ REFUNDED (if paid)
```
- Stock: **reserved** at PENDING, **deducted** at CONFIRMED (configurable: at PENDING or at SHIPPED), **restocked** on CANCELLED / RETURNED (if condition = resellable).
- Payment status is independent: `UNPAID | AUTHORIZED | PAID | PARTIALLY_REFUNDED | REFUNDED`. COD becomes PAID when driver/courier marks cash collected and it is reconciled.
- Every transition writes an `order_events` row (actor, from, to, reason, metadata).

---

## 8. Data Model (PostgreSQL)

Use Prisma (preferred) or Drizzle. All tables: `id` (UUID v7 / ULID), `created_at`, `updated_at`, soft-delete `deleted_at` where meaningful. Money stored as `BIGINT` minor units (centimes) + `currency` char(3). Translated text as JSONB.

**Core entities (minimum):**

| Domain | Tables |
|---|---|
| Identity | `users` (staff & customers, `type`), `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions`, `otp_codes`, `api_keys` |
| Customers | `customers` (phone unique, name, email?, group_id, loyalty_points, blacklisted, stats cache), `customer_addresses`, `customer_groups`, `customer_notes` |
| Catalog | `products`, `product_translations` (or JSONB), `product_options`, `product_option_values`, `variants` (sku unique, price, compare_at, cost, weight, barcode), `variant_option_values`, `media`, `product_media`, `categories` (ltree/closure), `collections`, `collection_rules`, `collection_products` (position), `brands`, `tags`, `product_tags`, `attributes`, `product_attributes`, `size_guides`, `bundles`, `bundle_items`, `related_products`, `reviews`, `review_media`, `stock_notifications` |
| Inventory | `locations`, `inventory_levels` (variant × location: on_hand, reserved, available generated), `stock_movements`, `suppliers`, `purchase_orders`, `purchase_order_items`, `stock_counts`, `stock_count_items` |
| Pricing/Promo | `promotions`, `promotion_rules`, `promotion_actions`, `promo_codes` (bulk codes), `promo_usages`, `price_schedules` |
| Sales | `carts`, `cart_items`, `orders` (number, customer snapshot, status, payment_status, totals breakdown, source/utm, agent_id, risk_score), `order_items` (variant snapshot: name, sku, price, cost at time), `order_events`, `order_notes`, `call_logs`, `returns`, `return_items`, `refunds`, `payments`, `invoices` |
| Shipping | `wilayas`, `communes`, `shipping_zones`, `shipping_rates`, `couriers`, `courier_credentials`, `shipments` (order, courier/driver, tracking, label_url, attempts, cost), `shipment_events`, `pickup_points`, `vehicles`, `drivers`, `delivery_runs`, `delivery_run_stops`, `cod_collections`, `courier_settlements`, `courier_settlement_lines` |
| Finance | `expenses`, `expense_categories`, `ad_spend`, `ledger_entries` |
| Content | `pages`, `menus`, `menu_items`, `banners`, `home_sections`, `announcements`, `redirects`, `newsletter_subscribers`, `contact_messages` |
| Marketing | `affiliates`, `loyalty_transactions`, `abandoned_carts` |
| System | `settings` (key/value JSONB, scoped), `notification_templates`, `notifications`, `audit_logs`, `analytics_events`, `jobs` (if not using external queue), `webhooks_inbound` |

Indexes: composite on `(status, created_at)` for orders, GIN on JSONB translations & tsvector columns, trigram on product names, `(customer_id, created_at)`, unique `(variant_id, location_id)`.

Seed data MUST include: 58 wilayas with communes, default roles/permissions, default shipping rates, sample categories/collections, ~40 demo products with variants, images and 2–3 GLB models, demo orders across all statuses, demo expenses — enough that every dashboard chart renders.

---

## 9. Design & UX Requirements

### 9.1 Brand direction (inspired by Goorin — reinterpreted, not copied)
- **Mood**: dark, premium, tactile. Base `#0F0F10`, surface `#1A1A1C`, accent **warm brass/gold** `#D9B36A` (verify AA contrast), secondary accent electric or cap-colour-driven highlight; light theme for admin by default with dark mode toggle.
- **Typography**: bold condensed display face for headlines (e.g. Bebas Neue / Anton / Archivo Black — free), clean grotesk for body (Inter / Manrope), Arabic pair (Cairo / Tajawal).
- **3D & motion**: hero cap rendered in real 3D (React Three Fiber) with slow auto-rotate, mouse/gyro parallax, and scroll-driven camera moves; product cards lift with subtle 3D tilt on hover; page transitions with Framer Motion; all motion respects `prefers-reduced-motion`; 3D lazy-loaded with poster fallback; target ≤ 1.5 MB total 3D payload above the fold.
- **Layout**: big imagery, generous whitespace, editorial collection headers, sticky add-to-cart bar on mobile PDP.
- **Micro-interactions**: add-to-cart flying animation, cart badge bounce, skeleton loaders, optimistic UI.

### 9.2 Design system
- Tailwind CSS + design tokens (colors, spacing, radius, shadows, typography) exported as CSS variables; component library built on **shadcn/ui** (Radix) for both apps; storefront gets brand-styled variants; Storybook for components.
- Icons: Lucide. Charts (admin): Recharts or ECharts. Tables: TanStack Table. Forms: React Hook Form + Zod (schemas shared with API).

### 9.3 Admin UX principles
- Everything is reachable in ≤ 2 clicks from the left nav; global command palette (⌘K) to jump to orders/products/customers by number/name/phone.
- Lists are dense, keyboard-friendly, with bulk selection; detail pages use a two-column layout (main + sidebar summary).
- Every destructive action confirms; every save shows a toast with undo where feasible.
- Real-time updates for new orders (WebSocket/SSE) with sound toggle.
- Mobile-usable: the owner will check orders from a phone.

---

## 10. Technical Architecture

### 10.1 Monorepo layout (pnpm workspaces + Turborepo)
```
jecks/
  apps/
    storefront/      React 18 + TypeScript + Vite (or Next.js 14 App Router if SSR chosen — see 10.2)
    admin/           React 18 + TypeScript + Vite SPA
    api/             Node.js 20 + TypeScript (NestJS preferred; Fastify+tRPC acceptable) 
    worker/          Background jobs (BullMQ) — notifications, media processing, reports, courier sync
  packages/
    db/              Prisma schema, migrations, seed
    shared/          Zod schemas, DTO types, enums, money & phone utils, i18n keys
    ui/              Shared design system components (shadcn-based) + tokens
    config/          eslint, tsconfig, tailwind presets
  infra/
    docker/          Dockerfiles, docker-compose (postgres, redis, minio, mailpit, api, worker, web)
    nginx/           reverse proxy config
  docs/
    PRD.md (this file), DECISIONS.md, API.md, RUNBOOK.md
```

### 10.2 Frontend decisions
- **Storefront MUST be SEO-capable** → use **Next.js (App Router, React Server Components)** for storefront; if the agent chooses Vite SPA, it MUST add pre-rendering (e.g. vite-plugin-ssr/`vike`) for product, collection and CMS routes. Document the decision.
- **Admin** = Vite SPA (no SEO needed), code-split per module, protected routes.
- State: TanStack Query for server state; Zustand for cart/UI state. Routing: Next router / React Router 6.
- 3D: `@react-three/fiber` + `@react-three/drei` (`useGLTF`, `Stage`, `OrbitControls`), `<model-viewer>` acceptable for PDP AR.

### 10.3 Backend
- **NestJS** modular monolith (modules mirror Section 5), Prisma ORM, class-validator/Zod pipes, OpenAPI (Swagger) auto-docs at `/docs`.
- REST JSON API versioned `/api/v1`; consistent envelope `{ data, meta, error }`; cursor pagination for large lists; ETag caching for catalog GETs.
- Auth: JWT access (15 min) + rotating refresh tokens (httpOnly cookie); phone OTP; TOTP 2FA for staff; RBAC guard with permission strings (`orders.update`, `finance.read`…).
- Realtime: Socket.IO / SSE channel for admin events (new order, status change).
- Jobs: **BullMQ on Redis** — notifications, image processing, courier tracking polling, report generation, scheduled promos/prices, abandoned-cart detection, daily KPI snapshots (`daily_stats` materialized for fast dashboards).
- Files: S3-compatible storage abstraction (`StorageProvider`: local | s3).
- Rate limiting (per IP/phone), Helmet, CORS, CSRF for cookie flows, input validation everywhere, audit log interceptor on mutating admin routes.
- Idempotency keys on order creation & webhooks.

### 10.4 Key API surface (illustrative, full list in `docs/API.md`)
```
Public:   GET /catalog/products?filters…   GET /catalog/products/:slug   GET /catalog/collections/:slug
          GET /catalog/search?q=            POST /cart  PATCH /cart/items  POST /cart/promo
          GET /shipping/wilayas             GET /shipping/quote?wilaya=&type=
          POST /orders  (guest COD)         GET /orders/track?number=&phone=
          POST /auth/otp/request  POST /auth/otp/verify   GET/POST /reviews
Admin:    /admin/products /admin/variants /admin/media /admin/collections /admin/promotions
          /admin/orders (+ /:id/transition, /:id/call-logs, /:id/documents)
          /admin/customers /admin/inventory /admin/purchase-orders /admin/suppliers
          /admin/shipping/{zones,rates,couriers,shipments,vehicles,drivers,runs,settlements}
          /admin/finance/{expenses,payments,pnl} /admin/reports/* /admin/settings /admin/users /admin/audit
Webhooks: POST /webhooks/couriers/:provider   POST /webhooks/payments/:provider
```

### 10.5 Database & migrations
Prisma migrations committed; `pnpm db:migrate`, `pnpm db:seed`. Use Postgres 16. Enable `pg_trgm`, `unaccent`, `uuid-ossp`/`pgcrypto`. Nightly `pg_dump` job to storage; restore documented in RUNBOOK.

### 10.6 Testing
- Unit (Vitest/Jest) for domain logic: promo engine, pricing/totals, state machine, stock movements, P&L calculations — these MUST have ≥ 90 % coverage.
- Integration tests for API modules against a test Postgres (Testcontainers).
- E2E (Playwright): guest COD checkout, admin creates product → appears on storefront, order confirm → ship → deliver flow, promo code application.
- CI (GitHub Actions): lint, typecheck, test, build, docker image on tag.

### 10.7 Performance
Storefront: LCP < 2.5 s on 4G, images via `next/image`/responsive `srcset`, 3D lazy & progressive (Draco-compressed GLB), route prefetch. API: p95 < 200 ms for catalog reads (cached in Redis 60 s, invalidated on write). Admin dashboard reads from pre-aggregated `daily_stats`.

### 10.8 Security & compliance
OWASP top-10 hygiene, secrets via env, encrypted courier/payment credentials at rest, PII minimization, customer data export/delete, staff 2FA, brute-force protection, signed URLs for private documents (invoices, labels).

### 10.9 Third-party services (all optional, each with a free fallback)
| Need | Default (free/self-hosted) | Optional provider |
|---|---|---|
| Object storage | MinIO (docker) | Cloudflare R2 / S3 |
| E-mail | Mailpit (dev) / SMTP | Brevo |
| SMS | Log-only adapter | Local Algerian gateway, Twilio |
| WhatsApp | Deep links (wa.me) | WhatsApp Cloud API |
| Maps | Leaflet + OpenStreetMap | Google Maps |
| Search | Postgres FTS | Meilisearch |
| Online payment | none (COD) | Chargily/SATIM, Stripe |
| Couriers | Manual/CSV | Yalidine, ZR Express, Maystro, EMS |
| Error tracking | Console/pino logs | Sentry |
| Analytics | Self-hosted events table | GA4 / Meta / TikTok pixels |

### 10.10 Deployment
Docker Compose for a single VPS (Nginx + Let's Encrypt, api, worker, web, postgres, redis, minio) as the v1 target. Environment templates `.env.example` for each app. Health endpoints, structured logs (pino), basic metrics endpoint. Zero-downtime deploy script and backup/restore documented in `docs/RUNBOOK.md`.

---

## 11. Non-functional Requirements

| Area | Requirement |
|---|---|
| Availability | 99.5 % monthly (single VPS acceptable for v1, automated backups) |
| Scale | 10k products, 100k customers, 1k orders/day without redesign |
| Browser support | Last 2 versions Chrome/Safari/Firefox/Edge, Android WebView (Instagram in-app browser) |
| Localization | fr/ar/en storefront; RTL correct on all storefront pages |
| Accessibility | WCAG 2.1 AA storefront |
| Observability | Request logs with correlation id, job dashboard (Bull Board), error alerts |
| Data | Daily backups, 30-day retention, tested restore |
| Code quality | Strict TypeScript, ESLint + Prettier, conventional commits, PR template |

---

## 12. Acceptance Criteria (definition of done for v1)

1. A guest on a phone can find a cap via search or menu, view it in 3D, pick colour/size, apply a promo code, choose wilaya/commune + delivery type, place a COD order with only name + phone + address, and receive a confirmation with a tracking link — in under 2 minutes.
2. The owner receives the order in real time, confirms it after a call (logged), prints a label, assigns it to a courier or to an own-fleet delivery run; the driver marks it delivered with cash collected; the dashboard shows revenue, COGS, shipping cost and **net profit** for that order the same day.
3. The owner can create a product with variants, images and a 3D model, put it in a smart collection, schedule a 30 % flash sale with countdown, and see it live on the storefront without developer help.
4. A failed delivery can be rescheduled or returned, stock is restored, and the customer's delivery success rate is updated.
5. All reports in 5.8–5.9 render with seeded data and export to Excel.
6. Roles work: an order agent cannot see finance; a driver only sees their run.
7. `docker compose up` on a clean machine brings up the full platform with seed data; CI is green.

---

## 13. Milestones & Delivery Order

| # | Milestone | Scope | Exit criteria |
|---|---|---|---|
| **M0** | Foundation (week 1) | Monorepo, tooling, docker-compose, Prisma schema (all core tables), seed (wilayas, roles, demo catalog), auth (staff + OTP), design tokens & UI package, Storybook | `pnpm dev` runs all apps; login works |
| **M1** | Catalog & Admin core (weeks 2–3) | Products/variants/media/3D upload, categories, collections (manual + smart), inventory levels, admin lists framework (table, filters, export), settings basics, users & roles | Owner can fully manage catalog |
| **M2** | Storefront (weeks 3–5) | Home (3D hero, sections), collection pages + filters/sort, PDP with 3D, search, cart, i18n fr/ar/en, SEO, CMS pages | Shop browsable & beautiful; Lighthouse ≥ 85 |
| **M3** | Checkout & Orders (weeks 5–6) | COD checkout, promo engine, shipping quotes, order state machine, admin orders module, call logs, documents/labels, notifications (email/SMS adapters), abandoned carts | End-to-end order flow |
| **M4** | Delivery & Cash (weeks 7–8) | Couriers (manual + adapter scaffolds + webhooks), fleet (vehicles, drivers, runs), driver mobile view, COD reconciliation, settlements | Delivery ops runnable |
| **M5** | Finance & Analytics (weeks 8–9) | Expenses, ad spend, payments ledger, P&L, daily stats, dashboard, reports library, customer segments, loyalty | Owner sees true profit |
| **M6** | Marketing & polish (weeks 10–11) | Home builder, banners/announcements, flash sales, affiliate codes, reviews, wishlist, newsletter, PWA, accessibility pass, performance pass | Acceptance criteria 1–7 pass |
| **M7** | Hardening & launch (week 12) | E2E suite, security review, backups/restore test, RUNBOOK, deployment to VPS, monitoring | Production live |

---

## 14. Future Ideas (v2+ backlog)
AR try-on of caps via face tracking; customer cap customizer (patch/colour picker with live 3D preview → custom order); gift cards; wholesale B2B portal with tiered pricing; POS mode for physical pop-ups; native mobile app (Flutter) reusing the API; marketplace feeds (Facebook/Instagram Shop, Google Merchant) automation; AI product descriptions & image background generation; predictive restock suggestions; multi-store/multi-brand tenancy.

---

## 15. Glossary
**COD** cash on delivery · **Stop-desk** courier pickup point where the customer collects the parcel · **Wilaya/Commune** Algerian province/municipality · **COGS** cost of goods sold (sum of variant cost price at order time) · **Settlement** periodic payout from a courier of collected COD minus fees · **Smart collection** collection populated automatically by rules · **Run** a driver's delivery route for a day.

---

## Appendix A — Prompt for Claude Code (Opus)

> You are implementing the Jeck's caps e-commerce platform described in `docs/PRD.md`. Start with milestone M0 exactly as specified in Section 13 and Section 10.1. Before writing code, produce `docs/DECISIONS.md` listing every choice you make where the PRD leaves options (SSR framework, ORM, NestJS vs Fastify, etc.) and `docs/API.md` skeleton. Then scaffold the monorepo, the Prisma schema covering all tables in Section 8, docker-compose with Postgres/Redis/MinIO/Mailpit, seed data (58 wilayas + communes, roles, demo catalog), authentication, and the shared UI package with the design tokens from Section 9. After each milestone, run lint/typecheck/tests and summarize what is done, what is pending, and any deviation from the PRD. Never skip the promo engine, order state machine, stock ledger, and P&L unit tests. Treat MUST requirements as non-negotiable.
