-- M5 — finance, reporting, customers and loyalty.

-- Two P&L lines that were being folded into others. The cost of taking money and the
-- revenue from delivery are decisions a shop makes separately from its expenses, so
-- they get columns rather than being backed out of a subtraction.
ALTER TABLE "daily_stats" ADD COLUMN IF NOT EXISTS "paymentFees" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "daily_stats" ADD COLUMN IF NOT EXISTS "shippingRevenue" BIGINT NOT NULL DEFAULT 0;

-- A report too large to stream is built in the background and collected later.
CREATE TABLE IF NOT EXISTS "report_exports" (
  "id"            UUID PRIMARY KEY,
  "report"        VARCHAR(64) NOT NULL,
  "format"        VARCHAR(8)  NOT NULL DEFAULT 'csv',
  "params"        JSONB       NOT NULL,
  "status"        VARCHAR(16) NOT NULL DEFAULT 'pending',
  "rowCount"      INTEGER     NOT NULL DEFAULT 0,
  "storageKey"    VARCHAR(400),
  "error"         TEXT,
  "requestedById" UUID,
  "startedAt"     TIMESTAMP(3),
  "finishedAt"    TIMESTAMP(3),
  "expiresAt"     TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_exports_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "report_exports_status_createdAt_idx"
  ON "report_exports" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "report_exports_requestedById_createdAt_idx"
  ON "report_exports" ("requestedById", "createdAt");

-- The P&L groups delivered orders by the day they were delivered, not the day they were
-- placed. Without this that query sorts the whole table every time it is asked.
CREATE INDEX IF NOT EXISTS "orders_deliveredAt_status_idx"
  ON "orders" ("deliveredAt", "status");

-- Customer segmentation runs nightly over everyone who has ever ordered.
CREATE INDEX IF NOT EXISTS "customers_lastOrderAt_idx" ON "customers" ("lastOrderAt");

-- Loyalty is earned on delivery and read back as a ledger per customer; the existing
-- index covers the read, this one covers "what did we award yesterday".
CREATE INDEX IF NOT EXISTS "loyalty_transactions_kind_createdAt_idx"
  ON "loyalty_transactions" ("kind", "createdAt");
