-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "module" VARCHAR(48) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "state" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_views_module_isShared_idx" ON "saved_views"("module", "isShared");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_userId_module_name_key" ON "saved_views"("userId", "module", "name");

-- CreateIndex
CREATE INDEX "categories_name_idx" ON "categories" USING GIN ("name" jsonb_path_ops);

-- CreateIndex
CREATE INDEX "collections_search_text_idx" ON "collections" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "order_items_variantId_createdAt_idx" ON "order_items"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_deliveredAt_idx" ON "orders"("deliveredAt");

-- CreateIndex
CREATE INDEX "orders_number_idx" ON "orders" USING GIN ("number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "orders_customerPhone_idx" ON "orders" USING GIN ("customerPhone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_search_vector_idx" ON "products" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "products_search_text_idx" ON "products" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products" USING GIN ("name" jsonb_path_ops);

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
