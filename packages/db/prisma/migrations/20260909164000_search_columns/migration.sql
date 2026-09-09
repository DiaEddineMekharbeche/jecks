-- Make full-text and fuzzy search Prisma-manageable.
--
-- Migration 20260909120500 created expression indexes -- GIN on ("name" ->> 'fr') and a
-- GENERATED tsvector column. Prisma's schema language can express neither, so its
-- differ proposed dropping them on every subsequent `migrate dev`: the schema and the
-- migrations could never agree, and CI would have to be told to ignore that.
--
-- The fix is to give the searchable text a real home. Two plain columns, maintained by
-- a trigger, hold what the expressions used to compute. Prisma can then declare both
-- columns and both indexes normally, and only the function and the trigger stay
-- outside its model -- which is fine, because its differ does not look at those.

-- 1. Drop what Prisma cannot see.
DROP INDEX IF EXISTS "products_search_vector_idx";
DROP INDEX IF EXISTS "products_name_fr_trgm_idx";
DROP INDEX IF EXISTS "collections_name_fr_trgm_idx";
DROP INDEX IF EXISTS "customers_phone_trgm_idx";
DROP INDEX IF EXISTS "orders_customer_phone_trgm_idx";
DROP INDEX IF EXISTS "orders_number_trgm_idx";
DROP INDEX IF EXISTS "products_name_gin_idx";
DROP INDEX IF EXISTS "categories_name_gin_idx";
DROP INDEX IF EXISTS "orders_delivered_at_idx";
DROP INDEX IF EXISTS "order_items_variant_created_idx";

ALTER TABLE "products" DROP COLUMN IF EXISTS "search_vector";

-- 2. Plain columns for the searchable text.
ALTER TABLE "products" ADD COLUMN "search_vector" tsvector;
ALTER TABLE "products" ADD COLUMN "search_text" TEXT NOT NULL DEFAULT '';
ALTER TABLE "collections" ADD COLUMN "search_text" TEXT NOT NULL DEFAULT '';

-- 3. Triggers keep them current. Firing only on the columns that feed them means an
--    unrelated update (a stock rollup, a sales counter) does not re-tokenize anything.
CREATE OR REPLACE FUNCTION jecks_products_search_refresh()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := jecks_product_search(NEW."name", NEW."description", NEW."styleLabel");
  NEW.search_text := unaccent(
    lower(
      concat_ws(' ',
        NEW."name" ->> 'fr',
        NEW."name" ->> 'en',
        NEW."name" ->> 'ar',
        NEW."styleLabel"
      )
    )
  );
  RETURN NEW;
END
$$;

CREATE TRIGGER products_search_refresh
  BEFORE INSERT OR UPDATE OF "name", "description", "styleLabel"
  ON "products"
  FOR EACH ROW
  EXECUTE FUNCTION jecks_products_search_refresh();

CREATE OR REPLACE FUNCTION jecks_collections_search_refresh()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := unaccent(
    lower(concat_ws(' ', NEW."name" ->> 'fr', NEW."name" ->> 'en', NEW."name" ->> 'ar', NEW."slug"))
  );
  RETURN NEW;
END
$$;

CREATE TRIGGER collections_search_refresh
  BEFORE INSERT OR UPDATE OF "name", "slug"
  ON "collections"
  FOR EACH ROW
  EXECUTE FUNCTION jecks_collections_search_refresh();

-- 4. Backfill the rows that already exist.
UPDATE "products"
SET search_vector = jecks_product_search("name", "description", "styleLabel"),
    search_text = unaccent(lower(concat_ws(' ', "name" ->> 'fr', "name" ->> 'en', "name" ->> 'ar', "styleLabel")));

UPDATE "collections"
SET search_text = unaccent(lower(concat_ws(' ', "name" ->> 'fr', "name" ->> 'en', "name" ->> 'ar', "slug")));

-- The indexes on these columns are declared in schema.prisma and created by the
-- migration that follows this one, so Prisma owns them from here on.
