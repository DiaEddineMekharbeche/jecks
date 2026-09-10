-- M3 — checkout, the order state machine and notifications.

-- Why an order scored what it did. An agent reads reasons, not a number.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "riskFlags" JSONB;

-- The state machine needs to know which of the two stock states an order is in.
-- Without these a cancellation cannot tell a release from a restock, and would either
-- leak held units or invent stock that was never taken.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "stockReserved" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "stockDeducted" BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing orders: anything past confirmation had its stock taken under the default
-- deduction moment, and anything still pending is holding a reservation.
UPDATE "orders"
   SET "stockDeducted" = TRUE
 WHERE status IN ('CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURN_REQUESTED')
   AND "stockDeducted" = FALSE;

UPDATE "orders"
   SET "stockReserved" = TRUE
 WHERE status = 'PENDING'
   AND "stockReserved" = FALSE;

-- The abandoned-cart sweep reads by expiry, and a full scan of every cart ever made is
-- not a query to run every fifteen minutes.
CREATE INDEX IF NOT EXISTS "carts_expiresAt_idx" ON "carts" ("expiresAt");

-- A queue retries. Without a stable key a retried job sends the same SMS twice, and a
-- customer who receives two "your order shipped" messages stops trusting the first.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupeKey" VARCHAR(160);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "locale" VARCHAR(5) NOT NULL DEFAULT 'fr';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupeKey_key" ON "notifications" ("dedupeKey");
