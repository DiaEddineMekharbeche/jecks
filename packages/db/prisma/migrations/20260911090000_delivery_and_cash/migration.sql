-- M4 — delivery, the fleet and cash on delivery.

-- What the courier has to bring back. It is the order total at the moment of shipping,
-- not the order total now: an order edited after it left the warehouse must not change
-- what the driver was told to collect.
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "codAmount" BIGINT NOT NULL DEFAULT 0;

UPDATE "shipments" s
   SET "codAmount" = o.total - o."paidTotal"
  FROM "orders" o
 WHERE o.id = s."orderId"
   AND s."codAmount" = 0
   AND o."paymentMethod" = 'COD';

-- Centroids. A delivery run is ordered by distance, and a map needs somewhere to put
-- the pin. Wilaya centroids are seeded from the bundled dataset; commune centroids are
-- filled in as they are learnt, and fall back to the wilaya.
ALTER TABLE "wilayas"  ADD COLUMN IF NOT EXISTS "latitude"  DECIMAL(9, 6);
ALTER TABLE "wilayas"  ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(9, 6);
ALTER TABLE "communes" ADD COLUMN IF NOT EXISTS "latitude"  DECIMAL(9, 6);
ALTER TABLE "communes" ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(9, 6);

-- Cash collected by a courier is chased the same way as cash collected by a driver, so
-- it gets the same relation and the same index.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cod_collections_courierId_fkey'
  ) THEN
    ALTER TABLE "cod_collections"
      ADD CONSTRAINT "cod_collections_courierId_fkey"
      FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "cod_collections_courierId_collectedAt_idx"
  ON "cod_collections" ("courierId", "collectedAt");

-- The courier sync job asks "what is still moving"; without this it scans every
-- shipment the shop has ever created.
CREATE INDEX IF NOT EXISTS "shipments_courierId_status_idx"
  ON "shipments" ("courierId", "status");
