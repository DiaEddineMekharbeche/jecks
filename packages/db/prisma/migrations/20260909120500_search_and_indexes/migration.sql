-- Search and reporting indexes that Prisma's schema language cannot express.
-- PRD Section 6.2 (weighted full text + typo tolerance) and Section 8 (index list).

-- Accent-insensitive French text search configuration.
CREATE TEXT SEARCH CONFIGURATION fr_unaccent (COPY = french);
ALTER TEXT SEARCH CONFIGURATION fr_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;

-- Immutable wrapper so the tsvector can live in a generated column.
CREATE OR REPLACE FUNCTION jecks_product_search(name jsonb, description jsonb, style text)
RETURNS tsvector
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT
    setweight(to_tsvector('fr_unaccent', coalesce(name ->> 'fr', '')), 'A') ||
    setweight(to_tsvector('fr_unaccent', coalesce(name ->> 'en', '')), 'A') ||
    setweight(to_tsvector('simple',      coalesce(name ->> 'ar', '')), 'A') ||
    setweight(to_tsvector('fr_unaccent', coalesce(style, '')), 'B') ||
    setweight(to_tsvector('fr_unaccent', coalesce(description ->> 'fr', '')), 'C');
$$;

ALTER TABLE "products"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (jecks_product_search("name", "description", "styleLabel")) STORED;

CREATE INDEX "products_search_vector_idx" ON "products" USING GIN ("search_vector");

-- Typo tolerance on the French product name (PRD F-ST-25).
CREATE INDEX "products_name_fr_trgm_idx"
  ON "products" USING GIN ((("name" ->> 'fr')) gin_trgm_ops);
CREATE INDEX "collections_name_fr_trgm_idx"
  ON "collections" USING GIN ((("name" ->> 'fr')) gin_trgm_ops);

-- Customer and order lookup by phone, the way the call centre searches.
CREATE INDEX "customers_phone_trgm_idx" ON "customers" USING GIN ("phone" gin_trgm_ops);
CREATE INDEX "orders_customer_phone_trgm_idx" ON "orders" USING GIN ("customerPhone" gin_trgm_ops);
CREATE INDEX "orders_number_trgm_idx" ON "orders" USING GIN ("number" gin_trgm_ops);

-- JSONB translation lookups used by the admin list filters.
CREATE INDEX "products_name_gin_idx" ON "products" USING GIN ("name" jsonb_path_ops);
CREATE INDEX "categories_name_gin_idx" ON "categories" USING GIN ("name" jsonb_path_ops);

-- Reporting: the P&L and dashboard scan orders by delivery date, not creation date.
CREATE INDEX "orders_delivered_at_idx" ON "orders" ("deliveredAt") WHERE "deliveredAt" IS NOT NULL;
CREATE INDEX "order_items_variant_created_idx" ON "order_items" ("variantId", "createdAt");

-- Order numbers come from a sequence so concurrent checkouts cannot collide.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;
