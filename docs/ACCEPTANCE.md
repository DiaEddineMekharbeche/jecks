# Acceptance

The seven criteria in PRD Section 12 are the definition of done for v1. This document
says, for each one, where it is proven and what is not proven.

Automated evidence is preferred and named by file. Where a criterion asks for something a
test cannot judge — "beautiful", "under two minutes" — the check is manual and the
procedure is written out so somebody else can repeat it.

Run the automated evidence with a seeded stack up:

```bash
pnpm docker:up && pnpm db:reset && pnpm db:seed
pnpm dev
pnpm e2e
```

---

## 1. A guest can buy a cap in under two minutes

> Find a cap via search or menu, view it in 3D, pick colour and size, apply a promo code,
> choose wilaya and commune and delivery type, place a COD order with only name, phone and
> address, and receive a confirmation with a tracking link.

| Part | Evidence |
|---|---|
| Browse, add to cart, checkout, confirmation | `e2e/tests/checkout.spec.ts` — "a visitor can buy a cap without an account", run on Desktop Chrome and on a Pixel 7 |
| Delivery fee follows the wilaya | `e2e/tests/checkout.spec.ts` — "the delivery fee changes with the wilaya" |
| Promo code at the cart | `e2e/tests/promotions.spec.ts` — applied and refused, both with a reason a shopper can act on |
| Name, phone, address and nothing else | The checkout schema in `packages/shared/src/schemas/checkout.ts`; no account is created and none is required |
| Tracking link | The confirmation page carries the order number and its public tracking URL |

**Manual: the two minutes, and the 3D.** The timing and the model are judged with a
stopwatch on a real phone, because a headless browser measures neither. The procedure:

1. Open the storefront on a phone, over the shop's own connection, not the office Wi-Fi.
2. Start the clock at the first tap. Search "casquette", open a product, rotate the
   model, pick a colour and a size, add to cart, enter a code, fill the three fields,
   confirm.
3. Stop at the confirmation screen.

Under two minutes with an unfamiliar tester is the bar. A tester who already knows the
flow does not count; they are not the customer.

---

## 2. The order reaches the owner, is walked to delivered, and shows profit the same day

> Real-time arrival, a logged confirmation call, a printed label, assignment to a courier
> or a run, the driver marking it delivered with cash collected, and revenue, COGS,
> shipping cost and net profit visible the same day.

| Part | Evidence |
|---|---|
| The state walk, pending to delivered | `e2e/tests/order-lifecycle.spec.ts` — "a pending order can be walked to delivered" |
| Illegal transitions refused by the server | `e2e/tests/order-lifecycle.spec.ts` — "an illegal transition is refused by the server, not hidden by the client", and `apps/api/src/modules/orders/domain/state-machine.spec.ts` |
| Profit for that order, the same day | `e2e/tests/order-lifecycle.spec.ts` — "a delivered order shows up in the profit and loss" |
| Labels and the manifest render as real PDFs | `e2e/tests/delivery.spec.ts` — "a run prints a manifest"; the writer itself in `apps/api/src/common/pdf/*.spec.ts` |
| Cash collected, counted and reconciled | `e2e/tests/delivery.spec.ts` — "the cash drawer keeps its three numbers apart" |
| The profit arithmetic | `packages/shared/src/finance/pnl.spec.ts`, one definition used by the API and the worker alike (D77) |

**Real time** is a WebSocket push, not a poll. The admin order list updates without a
refresh; a browser with its socket blocked falls back to refetching, so the criterion
holds either way.

**The call log** is written on the confirmation dialog and is part of the order's
timeline. Covered by the orders module tests rather than end to end, because what matters
is that the row exists, not how the dialog looks.

---

## 3. The owner ships a product without a developer

> Create a product with variants, images and a 3D model, put it in a smart collection,
> schedule a 30 % flash sale with a countdown, and see it live.

| Part | Evidence |
|---|---|
| Product created in the admin appears on the storefront | `e2e/tests/catalog-admin.spec.ts` — "a new product reaches the storefront" |
| A bad import says what it could not read | `e2e/tests/catalog-admin.spec.ts` — "a CSV import reports what it could not read" |
| Smart collection rules | `apps/api/src/modules/catalog/collection-rules.spec.ts` |
| Scheduled promotions with a window | `apps/api/src/modules/promotions/engine/promo-engine.spec.ts`; the simulator on the promotion page runs the same engine the cart does (D57) |
| Media and 3D upload | The upload pipeline, including the sniffer that refuses a file whose bytes contradict its declared type: `apps/api/src/modules/media/file-sniffer.spec.ts` |

**Manual: the countdown.** A flash sale scheduled to start in five minutes should appear
on the storefront by itself, with a ticking countdown, and stop by itself at the end.
Schedule one, watch both edges. Scheduled content filters on read (D83), so nothing has
to be switched off by hand.

---

## 4. A failed delivery restores stock and updates the customer

> A failed delivery can be rescheduled or returned, stock is restored, and the customer's
> delivery success rate is updated.

| Part | Evidence |
|---|---|
| The failure is recorded with a reason | `e2e/tests/failed-delivery.spec.ts` — "a failed delivery is recorded with a reason" |
| A failed order is not stranded | Same file — "a failed order can be sent out again or returned, not left stranded" |
| A return puts the stock back, through the ledger | Same file — "a return puts the stock back, and the ledger says who did", which counts movements before and after rather than trusting the on-hand number |
| Return and cancellation restock | `apps/api/src/modules/orders/domain/state-machine.spec.ts` — "restocks when a deducted order is cancelled", "restocks resellable returns" |
| A damaged return does not restock | Same file — restock is a decision on the return, not an automatic consequence |
| Reschedule keeps the shipment and moves the date | The delivery module; the routing and rate arithmetic in `apps/api/src/modules/delivery/domain/*.spec.ts` |
| The customer record remembers | `e2e/tests/failed-delivery.spec.ts` — the reliability figure is on the customer screen an agent already looks at |
| The customer's counts | `Customer.ordersCount` and `Customer.deliveredCount` are rolled up on every terminal transition; the risk score and the segment read them rather than aggregating on the fly |
| Success rate by wilaya and by driver | `apps/api/src/modules/delivery/delivery-analytics.service.ts`, rendered on Admin › Livraison › Analyse |

Stock never moves without a ledger row. The runbook's "stock looks wrong" query exists to
catch the one thing that would break this: a write to `inventory_levels` without a
matching movement.

---

## 5. Every report renders with seeded data and exports

| Report | Where |
|---|---|
| Sales, by day, product, category, wilaya | Admin › Rapports |
| Profit and loss, with COGS, shipping margin and net | Admin › Finance › P&L |
| Cash and settlements | Admin › Livraison › Caisse, Règlements |
| Delivery performance | Admin › Livraison › Analyse |
| Customers, cohorts, segments, loyalty | Admin › Clients |
| Inventory valuation and movements | Admin › Stock |

Export is one service for every list — `apps/api/src/common/list/export.service.ts` —
covering CSV and XLSX, so a new report inherits export rather than implementing it.
`export.service.spec.ts` covers both formats, the empty case, the byte-order mark that
stops Excel mangling every accent in a French or Arabic column, and a workbook large
enough to span several stream chunks.

A report exports two ways. The button on the screen streams the file back, which suits
the rows being looked at. For a long period there is a queued export with no row limit,
run by the worker and delivered as a link (D95); it needs `reports.export`, and
`report-exports.spec.ts` covers the failure paths that would otherwise leave a row stuck
on "running".

The seed produces a year of demo orders, so every report has something to draw. A report
that renders empty against the seed is a bug in the report.

---

## 6. Roles work

> An order agent cannot see finance; a driver only sees their run.

| Part | Evidence |
|---|---|
| The agent cannot reach the finance screen | `e2e/tests/roles.spec.ts` — "an order agent cannot reach the finances" |
| The agent can still do their own job | Same file — a guard that blocks everything passes the first test and fails the shop |
| The API refuses, not just the screen | Same file — "the API refuses the data, not just the screen", requesting the endpoint directly |
| A driver cannot ask for another driver's run | Same file — every `/driver` route resolves the driver from the session, never from a path parameter |
| The permission catalogue itself | `packages/shared/src/enums/permissions.ts`, one list driving the navigation, the route guards and the API |

Hiding a menu entry is not authorization. Every one of these tests asks the API directly,
because that is what an attacker does.

---

## 7. A clean machine comes up with `docker compose up`, and CI is green

| Part | Evidence |
|---|---|
| The stack starts from nothing | `docs/RUNBOOK.md` §1 and §3; `infra/docker/docker-compose.yml` for development, `docker-compose.prod.yml` for the VPS |
| Migrations apply to an empty database | CI job `migrations` — applies every migration to a fresh Postgres, then fails if `schema.prisma` and the migrations disagree |
| Lint, types, unit tests and coverage | CI job `quality`, with per-package coverage thresholds |
| Every app builds | CI job `build`, including Storybook |
| The seams hold | CI job `e2e`, which seeds demo data, starts the real stack and runs Playwright |
| Images build | CI job `images`, on a release tag |
| Deploy | `infra/deploy.sh`, which refuses on a bad environment, backs up before migrating, and verifies readiness before reporting success (D93) |

---

## What is not proven here

Said plainly, because an acceptance document that claims everything is not one.

- **The two-minute checkout and the 3D viewer are manual checks.** Both are written out
  above. Neither is in CI.
- **Lighthouse ≥ 85 is not enforced in CI.** It is measured by hand before a release. A
  budget in the pipeline is the right next step.
- **There is no integration harness against a real database.** Domain logic is unit
  tested against stubs, and the end-to-end suite covers the seams; what is missing is the
  middle layer, where a service runs against a real Postgres. Testcontainers is the
  intended shape.
- **The load target is scripted, not scheduled.** `e2e/load/catalog.js` asserts a p95
  under 200 ms at 200 concurrent readers and reads the cache hit rate back out of
  `/metrics`, but it runs when somebody runs it.
- **Arabic right-to-left layout is checked by eye.** The strings are translated and the
  direction switches; whether a specific page looks right in Arabic is a judgement.
