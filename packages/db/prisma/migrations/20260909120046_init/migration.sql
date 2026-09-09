-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'MODEL_3D', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURN_REQUESTED', 'RETURNED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'AUTHORIZED', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('COD', 'CARD', 'BANK_TRANSFER', 'LOYALTY');

-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('HOME', 'STOP_DESK');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('CREATED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryFailureReason" AS ENUM ('NO_ANSWER', 'REFUSED', 'WRONG_ADDRESS', 'CUSTOMER_ABSENT', 'RESCHEDULED', 'DAMAGED', 'OTHER');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('CONFIRMED', 'NO_ANSWER', 'CANCELLED', 'CALL_BACK', 'WRONG_NUMBER');

-- CreateEnum
CREATE TYPE "StockMovementReason" AS ENUM ('PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'TRANSFER', 'DAMAGED', 'STOCK_COUNT', 'RESERVATION', 'RELEASE');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING', 'BUY_X_GET_Y', 'BUNDLE_PRICE', 'TIERED');

-- CreateEnum
CREATE TYPE "PromotionScope" AS ENUM ('ORDER', 'PRODUCT', 'VARIANT', 'COLLECTION', 'CATEGORY', 'SHIPPING');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('WEB', 'PHONE', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'WHATSAPP', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('RESELLABLE', 'DAMAGED', 'MISSING_PARTS');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerSegment" AS ENUM ('NEW', 'RETURNING', 'VIP', 'AT_RISK', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL', 'WHATSAPP', 'TELEGRAM', 'IN_APP');

-- CreateEnum
CREATE TYPE "CollectionRuleField" AS ENUM ('TAG', 'CATEGORY', 'BRAND', 'PRICE', 'DISCOUNT', 'STOCK', 'CREATED_AT', 'TITLE');

-- CreateEnum
CREATE TYPE "RuleOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'CONTAINS', 'GREATER_THAN', 'LESS_THAN', 'IN');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeliveryRunStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('OPEN', 'SENT', 'PAID', 'DISPUTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "type" "UserType" NOT NULL DEFAULT 'STAFF',
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "passwordHash" VARCHAR(255),
    "avatarMediaId" UUID,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'fr',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "twoFactorSecret" VARCHAR(255),
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "name" JSONB NOT NULL,
    "description" VARCHAR(255),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "group" VARCHAR(48) NOT NULL,
    "description" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(255) NOT NULL,
    "userAgent" VARCHAR(400),
    "ip" VARCHAR(64),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "codeHash" VARCHAR(255) NOT NULL,
    "purpose" VARCHAR(24) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "ip" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "keyHash" VARCHAR(255) NOT NULL,
    "prefix" VARCHAR(12) NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_invitations" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "roleId" UUID NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_groups" (
    "id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "altPhone" VARCHAR(20),
    "fullName" VARCHAR(120) NOT NULL,
    "email" VARCHAR(255),
    "userId" UUID,
    "groupId" UUID,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'fr',
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "blacklistReason" VARCHAR(255),
    "acceptsMarketing" BOOLEAN NOT NULL DEFAULT false,
    "segment" "CustomerSegment" NOT NULL DEFAULT 'NEW',
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "cancelledCount" INTEGER NOT NULL DEFAULT 0,
    "lifetimeValue" BIGINT NOT NULL DEFAULT 0,
    "lastOrderAt" TIMESTAMP(3),
    "firstOrderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "label" VARCHAR(48),
    "fullName" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "wilayaCode" INTEGER NOT NULL,
    "communeId" UUID NOT NULL,
    "address" VARCHAR(400),
    "deliveryType" "DeliveryType" NOT NULL DEFAULT 'HOME',
    "pickupPointId" UUID,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(96) NOT NULL,
    "description" JSONB,
    "logoMediaId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" JSONB NOT NULL,
    "slug" VARCHAR(96) NOT NULL,
    "description" JSONB,
    "path" VARCHAR(400) NOT NULL DEFAULT '/',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "mediaId" UUID,
    "seoTitle" JSONB,
    "seoDescription" JSONB,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "slug" VARCHAR(96) NOT NULL,
    "description" JSONB,
    "isSmart" BOOLEAN NOT NULL DEFAULT false,
    "matchAll" BOOLEAN NOT NULL DEFAULT true,
    "mediaId" UUID,
    "heroMediaId" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "seoTitle" JSONB,
    "seoDescription" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_rules" (
    "id" UUID NOT NULL,
    "collectionId" UUID NOT NULL,
    "field" "CollectionRuleField" NOT NULL,
    "operator" "RuleOperator" NOT NULL,
    "value" VARCHAR(240) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_products" (
    "collectionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_products_pkey" PRIMARY KEY ("collectionId","productId")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tags" (
    "productId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("productId","tagId")
);

-- CreateTable
CREATE TABLE "size_guides" (
    "id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "body" JSONB NOT NULL,
    "categoryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "size_guides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "slug" VARCHAR(96) NOT NULL,
    "description" JSONB,
    "shortDescription" JSONB,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "brandId" UUID,
    "categoryId" UUID,
    "sizeGuideId" UUID,
    "styleLabel" VARCHAR(64),
    "seoTitle" JSONB,
    "seoDescription" JSONB,
    "publishedAt" TIMESTAMP(3),
    "trackInventory" BOOLEAN NOT NULL DEFAULT true,
    "allowBackorder" BOOLEAN NOT NULL DEFAULT false,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "shippingClass" VARCHAR(64),
    "minPrice" BIGINT NOT NULL DEFAULT 0,
    "maxPrice" BIGINT NOT NULL DEFAULT 0,
    "maxCompareAt" BIGINT,
    "totalStock" INTEGER NOT NULL DEFAULT 0,
    "ratingAverage" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_options" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "kind" VARCHAR(24) NOT NULL DEFAULT 'text',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "id" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "swatchHex" VARCHAR(7),
    "mediaId" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variants" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "barcode" VARCHAR(64),
    "name" VARCHAR(160),
    "price" BIGINT NOT NULL,
    "compareAtPrice" BIGINT,
    "costPrice" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "weightGrams" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_option_values" (
    "variantId" UUID NOT NULL,
    "optionValueId" UUID NOT NULL,

    CONSTRAINT "variant_option_values_pkey" PRIMARY KEY ("variantId","optionValueId")
);

-- CreateTable
CREATE TABLE "media_folders" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL DEFAULT 'IMAGE',
    "folderId" UUID,
    "storageKey" VARCHAR(400) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "renditions" JSONB,
    "posterKey" VARCHAR(400),
    "blurhash" VARCHAR(64),
    "alt" JSONB,
    "checksum" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "productId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("productId","mediaId")
);

-- CreateTable
CREATE TABLE "variant_media" (
    "variantId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_media_pkey" PRIMARY KEY ("variantId","mediaId")
);

-- CreateTable
CREATE TABLE "attributes" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" JSONB NOT NULL,
    "kind" VARCHAR(24) NOT NULL DEFAULT 'text',
    "options" JSONB,
    "filterable" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attributes" (
    "productId" UUID NOT NULL,
    "attributeId" UUID NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("productId","attributeId")
);

-- CreateTable
CREATE TABLE "related_products" (
    "productId" UUID NOT NULL,
    "relatedProductId" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL DEFAULT 'related',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "related_products_pkey" PRIMARY KEY ("productId","relatedProductId","kind")
);

-- CreateTable
CREATE TABLE "bundles" (
    "id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "slug" VARCHAR(96) NOT NULL,
    "description" JSONB,
    "bundlePrice" BIGINT,
    "discountPercent" DECIMAL(5,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_items" (
    "id" UUID NOT NULL,
    "bundleId" UUID NOT NULL,
    "productId" UUID,
    "variantId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bundle_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "customerId" UUID,
    "orderId" UUID,
    "rating" INTEGER NOT NULL,
    "title" VARCHAR(120),
    "body" TEXT NOT NULL,
    "authorName" VARCHAR(80) NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_media" (
    "reviewId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "review_media_pkey" PRIMARY KEY ("reviewId","mediaId")
);

-- CreateTable
CREATE TABLE "stock_notifications" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "customerId" UUID,
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "address" VARCHAR(400),
    "wilayaCode" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_levels" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "incoming" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "referenceType" VARCHAR(40),
    "referenceId" UUID,
    "note" VARCHAR(400),
    "actorId" UUID,
    "balanceAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "contactName" VARCHAR(120),
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "address" VARCHAR(400),
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "supplierId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "shippingCost" BIGINT NOT NULL DEFAULT 0,
    "otherCost" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "expectedAt" TIMESTAMP(3),
    "orderedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" UUID NOT NULL,
    "stockCountId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "expectedQuantity" INTEGER NOT NULL,
    "countedQuantity" INTEGER,
    "variance" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "type" "PromotionType" NOT NULL,
    "scope" "PromotionScope" NOT NULL DEFAULT 'ORDER',
    "code" VARCHAR(48),
    "percentOff" DECIMAL(5,2),
    "amountOff" BIGINT,
    "bundlePrice" BIGINT,
    "buyXGetY" JSONB,
    "tiers" JSONB,
    "minSubtotal" BIGINT,
    "minQuantity" INTEGER,
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "wilayaCodes" INTEGER[],
    "usageLimitTotal" INTEGER,
    "usageLimitPerCustomer" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "showCountdown" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_products" (
    "promotionId" UUID NOT NULL,
    "productId" UUID NOT NULL,

    CONSTRAINT "promotion_products_pkey" PRIMARY KEY ("promotionId","productId")
);

-- CreateTable
CREATE TABLE "promotion_variants" (
    "promotionId" UUID NOT NULL,
    "variantId" UUID NOT NULL,

    CONSTRAINT "promotion_variants_pkey" PRIMARY KEY ("promotionId","variantId")
);

-- CreateTable
CREATE TABLE "promotion_collections" (
    "promotionId" UUID NOT NULL,
    "collectionId" UUID NOT NULL,

    CONSTRAINT "promotion_collections_pkey" PRIMARY KEY ("promotionId","collectionId")
);

-- CreateTable
CREATE TABLE "promotion_categories" (
    "promotionId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "promotion_categories_pkey" PRIMARY KEY ("promotionId","categoryId")
);

-- CreateTable
CREATE TABLE "promotion_customer_groups" (
    "promotionId" UUID NOT NULL,
    "groupId" UUID NOT NULL,

    CONSTRAINT "promotion_customer_groups_pkey" PRIMARY KEY ("promotionId","groupId")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "promotionId" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "usageLimit" INTEGER NOT NULL DEFAULT 1,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_usages" (
    "id" UUID NOT NULL,
    "promotionId" UUID NOT NULL,
    "promoCodeId" UUID,
    "orderId" UUID,
    "customerId" UUID,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_schedules" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "price" BIGINT NOT NULL,
    "compareAtPrice" BIGINT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "token" VARCHAR(128) NOT NULL,
    "customerId" UUID,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "promoCode" VARCHAR(48),
    "wilayaCode" INTEGER,
    "deliveryType" "DeliveryType",
    "note" VARCHAR(500),
    "convertedOrderId" UUID,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "bundleId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "customerId" UUID,
    "agentId" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'COD',
    "source" "OrderSource" NOT NULL DEFAULT 'WEB',
    "customerName" VARCHAR(120) NOT NULL,
    "customerPhone" VARCHAR(20) NOT NULL,
    "customerAltPhone" VARCHAR(20),
    "customerEmail" VARCHAR(255),
    "wilayaCode" INTEGER NOT NULL,
    "wilayaName" VARCHAR(120) NOT NULL,
    "communeId" UUID,
    "communeName" VARCHAR(160),
    "deliveryType" "DeliveryType" NOT NULL DEFAULT 'HOME',
    "address" VARCHAR(400),
    "pickupPointId" UUID,
    "pickupPointName" VARCHAR(200),
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "itemsSubtotal" BIGINT NOT NULL DEFAULT 0,
    "discountTotal" BIGINT NOT NULL DEFAULT 0,
    "shippingTotal" BIGINT NOT NULL DEFAULT 0,
    "shippingCost" BIGINT NOT NULL DEFAULT 0,
    "loyaltyDiscount" BIGINT NOT NULL DEFAULT 0,
    "taxTotal" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "cogsTotal" BIGINT NOT NULL DEFAULT 0,
    "paidTotal" BIGINT NOT NULL DEFAULT 0,
    "refundedTotal" BIGINT NOT NULL DEFAULT 0,
    "weightGrams" INTEGER NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(500),
    "internalNote" TEXT,
    "tags" TEXT[],
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "utmSource" VARCHAR(120),
    "utmMedium" VARCHAR(120),
    "utmCampaign" VARCHAR(120),
    "utmContent" VARCHAR(120),
    "utmTerm" VARCHAR(120),
    "idempotencyKey" VARCHAR(128),
    "ip" VARCHAR(64),
    "confirmedAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "variantId" UUID,
    "bundleId" UUID,
    "productName" JSONB NOT NULL,
    "variantName" VARCHAR(160),
    "sku" VARCHAR(64) NOT NULL,
    "mediaKey" VARCHAR(400),
    "quantity" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "unitCost" BIGINT NOT NULL DEFAULT 0,
    "unitCompareAt" BIGINT,
    "discountAmount" BIGINT NOT NULL DEFAULT 0,
    "lineTotal" BIGINT NOT NULL,
    "refundedQuantity" INTEGER NOT NULL DEFAULT 0,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "actorId" UUID,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus",
    "kind" VARCHAR(24) NOT NULL DEFAULT 'status',
    "reason" VARCHAR(500),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_notes" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "agentId" UUID,
    "outcome" "CallOutcome" NOT NULL,
    "note" TEXT,
    "callBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "reason" VARCHAR(300),
    "status" VARCHAR(24) NOT NULL DEFAULT 'REQUESTED',
    "restock" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" "ReturnCondition" NOT NULL DEFAULT 'RESELLABLE',
    "reason" VARCHAR(300),

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "status" VARCHAR(24) NOT NULL DEFAULT 'captured',
    "provider" VARCHAR(48),
    "providerRef" VARCHAR(128),
    "feeAmount" BIGINT NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "returnId" UUID,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "reason" VARCHAR(300),
    "method" "PaymentMethod" NOT NULL DEFAULT 'COD',
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "storageKey" VARCHAR(400),
    "total" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wilayas" (
    "code" INTEGER NOT NULL,
    "name" JSONB NOT NULL,
    "nameAscii" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wilayas_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "communes" (
    "id" UUID NOT NULL,
    "wilayaCode" INTEGER NOT NULL,
    "name" JSONB NOT NULL,
    "nameAscii" VARCHAR(160) NOT NULL,
    "postalCode" VARCHAR(10),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "wilayaCodes" INTEGER[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" UUID NOT NULL,
    "zoneId" UUID,
    "wilayaCode" INTEGER,
    "courierId" UUID,
    "deliveryType" "DeliveryType" NOT NULL DEFAULT 'HOME',
    "price" BIGINT NOT NULL,
    "cost" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "freeWeightGrams" INTEGER NOT NULL DEFAULT 1000,
    "extraPerKg" BIGINT NOT NULL DEFAULT 0,
    "freeShippingThreshold" BIGINT,
    "etaMinDays" INTEGER NOT NULL DEFAULT 1,
    "etaMaxDays" INTEGER NOT NULL DEFAULT 4,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "couriers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "provider" VARCHAR(48) NOT NULL DEFAULT 'manual',
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "codFeePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "settlementDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_credentials" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_points" (
    "id" UUID NOT NULL,
    "courierId" UUID,
    "wilayaCode" INTEGER NOT NULL,
    "communeId" UUID,
    "name" VARCHAR(200) NOT NULL,
    "address" VARCHAR(400) NOT NULL,
    "phone" VARCHAR(20),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "openingHours" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pickup_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "plate" VARCHAR(24) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(24) NOT NULL DEFAULT 'van',
    "capacityKg" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(400),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "wilayaCode" INTEGER,
    "licenseNo" VARCHAR(48),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_runs" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "date" DATE NOT NULL,
    "driverId" UUID NOT NULL,
    "vehicleId" UUID,
    "status" "DeliveryRunStatus" NOT NULL DEFAULT 'PLANNED',
    "note" VARCHAR(500),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "expectedCash" BIGINT NOT NULL DEFAULT 0,
    "collectedCash" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_run_stops" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "failureReason" "DeliveryFailureReason",
    "cashCollected" BIGINT NOT NULL DEFAULT 0,
    "note" VARCHAR(400),
    "proofMediaId" UUID,
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_run_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "courierId" UUID,
    "driverId" UUID,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'CREATED',
    "trackingNumber" VARCHAR(64),
    "trackingUrl" VARCHAR(400),
    "labelKey" VARCHAR(400),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "cost" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "failureReason" "DeliveryFailureReason",
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "rawStatus" VARCHAR(120),
    "message" VARCHAR(500),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cod_collections" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "driverId" UUID,
    "courierId" UUID,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciledAt" TIMESTAMP(3),
    "note" VARCHAR(400),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cod_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_settlements" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "reference" VARCHAR(48) NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'OPEN',
    "grossAmount" BIGINT NOT NULL DEFAULT 0,
    "feesAmount" BIGINT NOT NULL DEFAULT 0,
    "netAmount" BIGINT NOT NULL DEFAULT 0,
    "paidAmount" BIGINT NOT NULL DEFAULT 0,
    "difference" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_settlement_lines" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "codAmount" BIGINT NOT NULL DEFAULT 0,
    "feeAmount" BIGINT NOT NULL DEFAULT 0,
    "netAmount" BIGINT NOT NULL DEFAULT 0,
    "note" VARCHAR(300),

    CONSTRAINT "courier_settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "color" VARCHAR(7),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "categoryId" UUID,
    "label" VARCHAR(200) NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "incurredAt" DATE NOT NULL,
    "recurrence" VARCHAR(16),
    "recurrenceEndsAt" DATE,
    "parentId" UUID,
    "attachmentKey" VARCHAR(400),
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_spend" (
    "id" UUID NOT NULL,
    "platform" VARCHAR(48) NOT NULL,
    "campaign" VARCHAR(160),
    "spentOn" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "impressions" INTEGER,
    "clicks" INTEGER,
    "note" VARCHAR(400),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_spend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "account" VARCHAR(32) NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "orderId" UUID,
    "referenceType" VARCHAR(40),
    "referenceId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" VARCHAR(400),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "day" DATE NOT NULL,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "cancelledCount" INTEGER NOT NULL DEFAULT 0,
    "revenue" BIGINT NOT NULL DEFAULT 0,
    "cogs" BIGINT NOT NULL DEFAULT 0,
    "shippingCost" BIGINT NOT NULL DEFAULT 0,
    "discounts" BIGINT NOT NULL DEFAULT 0,
    "refunds" BIGINT NOT NULL DEFAULT 0,
    "expenses" BIGINT NOT NULL DEFAULT 0,
    "adSpend" BIGINT NOT NULL DEFAULT 0,
    "grossProfit" BIGINT NOT NULL DEFAULT 0,
    "netProfit" BIGINT NOT NULL DEFAULT 0,
    "newCustomers" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(96) NOT NULL,
    "title" JSONB NOT NULL,
    "body" JSONB NOT NULL,
    "excerpt" JSONB,
    "heroMediaId" UUID,
    "seoTitle" JSONB,
    "seoDescription" JSONB,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "kind" VARCHAR(16) NOT NULL DEFAULT 'page',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "name" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "menuId" UUID NOT NULL,
    "parentId" UUID,
    "label" JSONB NOT NULL,
    "url" VARCHAR(400) NOT NULL,
    "imageKey" VARCHAR(400),
    "position" INTEGER NOT NULL DEFAULT 0,
    "openInNewTab" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banners" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "placement" VARCHAR(48) NOT NULL,
    "title" JSONB,
    "subtitle" JSONB,
    "ctaLabel" JSONB,
    "ctaUrl" VARCHAR(400),
    "mediaId" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "message" JSONB NOT NULL,
    "linkUrl" VARCHAR(400),
    "bgColor" VARCHAR(7),
    "textColor" VARCHAR(7),
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_sections" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(48) NOT NULL,
    "title" JSONB,
    "subtitle" JSONB,
    "ctaLabel" JSONB,
    "ctaUrl" VARCHAR(400),
    "mediaId" UUID,
    "collectionId" UUID,
    "productId" UUID,
    "config" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redirects" (
    "id" UUID NOT NULL,
    "fromPath" VARCHAR(400) NOT NULL,
    "toPath" VARCHAR(400) NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 301,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscribers" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "locale" VARCHAR(5) NOT NULL DEFAULT 'fr',
    "source" VARCHAR(48),
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "handle" VARCHAR(64) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "promotionId" UUID,
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "orderId" UUID,
    "points" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "note" VARCHAR(300),
    "balanceAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abandoned_carts" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "customerId" UUID,
    "phone" VARCHAR(20),
    "fullName" VARCHAR(120),
    "wilayaCode" INTEGER,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "recoveryCode" VARCHAR(48),
    "contactedAt" TIMESTAMP(3),
    "recoveredOrderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "abandoned_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(120) NOT NULL,
    "scope" VARCHAR(48) NOT NULL DEFAULT 'global',
    "value" JSONB NOT NULL,
    "secret" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "event" VARCHAR(64) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" JSONB,
    "body" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "event" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT,
    "link" VARCHAR(400),
    "recipient" VARCHAR(255),
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "error" VARCHAR(500),
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorLabel" VARCHAR(160),
    "action" VARCHAR(64) NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" VARCHAR(64),
    "changes" JSONB,
    "ip" VARCHAR(64),
    "userAgent" VARCHAR(400),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "name" VARCHAR(48) NOT NULL,
    "sessionId" VARCHAR(64) NOT NULL,
    "customerId" UUID,
    "productId" UUID,
    "variantId" UUID,
    "orderId" UUID,
    "path" VARCHAR(400),
    "referrer" VARCHAR(400),
    "utmSource" VARCHAR(120),
    "utmMedium" VARCHAR(120),
    "utmCampaign" VARCHAR(120),
    "query" VARCHAR(200),
    "resultCount" INTEGER,
    "value" BIGINT,
    "device" VARCHAR(24),
    "wilayaCode" INTEGER,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks_inbound" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(48) NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "signature" VARCHAR(400),
    "headers" JSONB,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" VARCHAR(500),
    "idempotencyKey" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_inbound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "queue" VARCHAR(48) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_type_active_idx" ON "users"("type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "roles_slug_key" ON "roles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_expiresAt_idx" ON "sessions"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "otp_codes_phone_purpose_expiresAt_idx" ON "otp_codes"("phone", "purpose", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "staff_invitations_tokenHash_key" ON "staff_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "staff_invitations_email_idx" ON "staff_invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_groups_slug_key" ON "customer_groups"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_userId_key" ON "customers"("userId");

-- CreateIndex
CREATE INDEX "customers_segment_createdAt_idx" ON "customers"("segment", "createdAt");

-- CreateIndex
CREATE INDEX "customers_blacklisted_idx" ON "customers"("blacklisted");

-- CreateIndex
CREATE INDEX "customer_addresses_customerId_idx" ON "customer_addresses"("customerId");

-- CreateIndex
CREATE INDEX "customer_notes_customerId_createdAt_idx" ON "customer_notes"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_customerId_productId_variantId_key" ON "wishlist_items"("customerId", "productId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parentId_position_idx" ON "categories"("parentId", "position");

-- CreateIndex
CREATE INDEX "categories_path_idx" ON "categories"("path");

-- CreateIndex
CREATE UNIQUE INDEX "collections_slug_key" ON "collections"("slug");

-- CreateIndex
CREATE INDEX "collection_rules_collectionId_idx" ON "collection_rules"("collectionId");

-- CreateIndex
CREATE INDEX "collection_products_collectionId_pinned_position_idx" ON "collection_products"("collectionId", "pinned", "position");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_status_publishedAt_idx" ON "products"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "products_categoryId_status_idx" ON "products"("categoryId", "status");

-- CreateIndex
CREATE INDEX "products_salesCount_idx" ON "products"("salesCount" DESC);

-- CreateIndex
CREATE INDEX "product_options_productId_position_idx" ON "product_options"("productId", "position");

-- CreateIndex
CREATE INDEX "product_option_values_optionId_position_idx" ON "product_option_values"("optionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "variants_sku_key" ON "variants"("sku");

-- CreateIndex
CREATE INDEX "variants_productId_position_idx" ON "variants"("productId", "position");

-- CreateIndex
CREATE INDEX "media_kind_createdAt_idx" ON "media"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "product_media_productId_position_idx" ON "product_media"("productId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "attributes_key_key" ON "attributes"("key");

-- CreateIndex
CREATE UNIQUE INDEX "bundles_slug_key" ON "bundles"("slug");

-- CreateIndex
CREATE INDEX "bundle_items_bundleId_idx" ON "bundle_items"("bundleId");

-- CreateIndex
CREATE INDEX "reviews_productId_status_createdAt_idx" ON "reviews"("productId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "stock_notifications_variantId_notifiedAt_idx" ON "stock_notifications"("variantId", "notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

-- CreateIndex
CREATE INDEX "inventory_levels_locationId_idx" ON "inventory_levels"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_levels_variantId_locationId_key" ON "inventory_levels"("variantId", "locationId");

-- CreateIndex
CREATE INDEX "stock_movements_variantId_createdAt_idx" ON "stock_movements"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_referenceType_referenceId_idx" ON "stock_movements"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders"("number");

-- CreateIndex
CREATE INDEX "purchase_orders_status_createdAt_idx" ON "purchase_orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchaseOrderId_idx" ON "purchase_order_items"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_items_stockCountId_variantId_key" ON "stock_count_items"("stockCountId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");

-- CreateIndex
CREATE INDEX "promotions_active_startsAt_endsAt_idx" ON "promotions"("active", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "promotions_priority_idx" ON "promotions"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_codes_promotionId_idx" ON "promo_codes"("promotionId");

-- CreateIndex
CREATE INDEX "promo_usages_promotionId_createdAt_idx" ON "promo_usages"("promotionId", "createdAt");

-- CreateIndex
CREATE INDEX "promo_usages_customerId_idx" ON "promo_usages"("customerId");

-- CreateIndex
CREATE INDEX "price_schedules_startsAt_appliedAt_idx" ON "price_schedules"("startsAt", "appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "carts_token_key" ON "carts"("token");

-- CreateIndex
CREATE INDEX "carts_customerId_idx" ON "carts"("customerId");

-- CreateIndex
CREATE INDEX "carts_updatedAt_idx" ON "carts"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_variantId_bundleId_key" ON "cart_items"("cartId", "variantId", "bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_paymentStatus_status_idx" ON "orders"("paymentStatus", "status");

-- CreateIndex
CREATE INDEX "orders_wilayaCode_createdAt_idx" ON "orders"("wilayaCode", "createdAt");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_variantId_idx" ON "order_items"("variantId");

-- CreateIndex
CREATE INDEX "order_events_orderId_createdAt_idx" ON "order_events"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_notes_orderId_createdAt_idx" ON "order_notes"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "call_logs_orderId_createdAt_idx" ON "call_logs"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "call_logs_agentId_createdAt_idx" ON "call_logs"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "returns_number_key" ON "returns"("number");

-- CreateIndex
CREATE INDEX "returns_orderId_idx" ON "returns"("orderId");

-- CreateIndex
CREATE INDEX "return_items_returnId_idx" ON "return_items"("returnId");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_receivedAt_idx" ON "payments"("receivedAt");

-- CreateIndex
CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_orderId_idx" ON "invoices"("orderId");

-- CreateIndex
CREATE INDEX "communes_wilayaCode_idx" ON "communes"("wilayaCode");

-- CreateIndex
CREATE UNIQUE INDEX "communes_wilayaCode_nameAscii_key" ON "communes"("wilayaCode", "nameAscii");

-- CreateIndex
CREATE INDEX "shipping_rates_zoneId_idx" ON "shipping_rates"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_rates_wilayaCode_courierId_deliveryType_key" ON "shipping_rates"("wilayaCode", "courierId", "deliveryType");

-- CreateIndex
CREATE UNIQUE INDEX "couriers_slug_key" ON "couriers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "courier_credentials_courierId_key_key" ON "courier_credentials"("courierId", "key");

-- CreateIndex
CREATE INDEX "pickup_points_wilayaCode_active_idx" ON "pickup_points"("wilayaCode", "active");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_userId_key" ON "drivers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_runs_code_key" ON "delivery_runs"("code");

-- CreateIndex
CREATE INDEX "delivery_runs_date_driverId_idx" ON "delivery_runs"("date", "driverId");

-- CreateIndex
CREATE INDEX "delivery_run_stops_runId_position_idx" ON "delivery_run_stops"("runId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_run_stops_runId_orderId_key" ON "delivery_run_stops"("runId", "orderId");

-- CreateIndex
CREATE INDEX "shipments_orderId_idx" ON "shipments"("orderId");

-- CreateIndex
CREATE INDEX "shipments_trackingNumber_idx" ON "shipments"("trackingNumber");

-- CreateIndex
CREATE INDEX "shipments_status_updatedAt_idx" ON "shipments"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "shipment_events_shipmentId_occurredAt_idx" ON "shipment_events"("shipmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "cod_collections_driverId_collectedAt_idx" ON "cod_collections"("driverId", "collectedAt");

-- CreateIndex
CREATE INDEX "cod_collections_reconciledAt_idx" ON "cod_collections"("reconciledAt");

-- CreateIndex
CREATE UNIQUE INDEX "courier_settlements_reference_key" ON "courier_settlements"("reference");

-- CreateIndex
CREATE INDEX "courier_settlements_courierId_periodTo_idx" ON "courier_settlements"("courierId", "periodTo");

-- CreateIndex
CREATE UNIQUE INDEX "courier_settlement_lines_settlementId_orderId_key" ON "courier_settlement_lines"("settlementId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_slug_key" ON "expense_categories"("slug");

-- CreateIndex
CREATE INDEX "expenses_incurredAt_idx" ON "expenses"("incurredAt");

-- CreateIndex
CREATE INDEX "expenses_categoryId_incurredAt_idx" ON "expenses"("categoryId", "incurredAt");

-- CreateIndex
CREATE INDEX "ad_spend_spentOn_idx" ON "ad_spend"("spentOn");

-- CreateIndex
CREATE UNIQUE INDEX "ad_spend_platform_campaign_spentOn_key" ON "ad_spend"("platform", "campaign", "spentOn");

-- CreateIndex
CREATE INDEX "ledger_entries_account_occurredAt_idx" ON "ledger_entries"("account", "occurredAt");

-- CreateIndex
CREATE INDEX "ledger_entries_kind_occurredAt_idx" ON "ledger_entries"("kind", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "pages_slug_key" ON "pages"("slug");

-- CreateIndex
CREATE INDEX "pages_kind_published_idx" ON "pages"("kind", "published");

-- CreateIndex
CREATE UNIQUE INDEX "menus_slug_key" ON "menus"("slug");

-- CreateIndex
CREATE INDEX "menu_items_menuId_position_idx" ON "menu_items"("menuId", "position");

-- CreateIndex
CREATE INDEX "banners_placement_active_position_idx" ON "banners"("placement", "active", "position");

-- CreateIndex
CREATE INDEX "announcements_active_startsAt_endsAt_idx" ON "announcements"("active", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "home_sections_active_position_idx" ON "home_sections"("active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "redirects_fromPath_key" ON "redirects"("fromPath");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_phone_key" ON "newsletter_subscribers"("phone");

-- CreateIndex
CREATE INDEX "contact_messages_readAt_createdAt_idx" ON "contact_messages"("readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_handle_key" ON "affiliates"("handle");

-- CreateIndex
CREATE INDEX "loyalty_transactions_customerId_createdAt_idx" ON "loyalty_transactions"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "abandoned_carts_cartId_key" ON "abandoned_carts"("cartId");

-- CreateIndex
CREATE INDEX "abandoned_carts_contactedAt_createdAt_idx" ON "abandoned_carts"("contactedAt", "createdAt");

-- CreateIndex
CREATE INDEX "settings_scope_idx" ON "settings"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_event_channel_key" ON "notification_templates"("event", "channel");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_status_createdAt_idx" ON "notifications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_name_occurredAt_idx" ON "analytics_events"("name", "occurredAt");

-- CreateIndex
CREATE INDEX "analytics_events_sessionId_occurredAt_idx" ON "analytics_events"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "analytics_events_productId_name_idx" ON "analytics_events"("productId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "webhooks_inbound_idempotencyKey_key" ON "webhooks_inbound"("idempotencyKey");

-- CreateIndex
CREATE INDEX "webhooks_inbound_provider_processedAt_idx" ON "webhooks_inbound"("provider", "processedAt");

-- CreateIndex
CREATE INDEX "jobs_queue_status_runAt_idx" ON "jobs"("queue", "status", "runAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "customer_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "wilayas"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_communeId_fkey" FOREIGN KEY ("communeId") REFERENCES "communes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_pickupPointId_fkey" FOREIGN KEY ("pickupPointId") REFERENCES "pickup_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_logoMediaId_fkey" FOREIGN KEY ("logoMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_heroMediaId_fkey" FOREIGN KEY ("heroMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_rules" ADD CONSTRAINT "collection_rules_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "size_guides" ADD CONSTRAINT "size_guides_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_sizeGuideId_fkey" FOREIGN KEY ("sizeGuideId") REFERENCES "size_guides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "product_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_optionValueId_fkey" FOREIGN KEY ("optionValueId") REFERENCES "product_option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_media" ADD CONSTRAINT "variant_media_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_media" ADD CONSTRAINT "variant_media_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "related_products" ADD CONSTRAINT "related_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "related_products" ADD CONSTRAINT "related_products_relatedProductId_fkey" FOREIGN KEY ("relatedProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_notifications" ADD CONSTRAINT "stock_notifications_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_notifications" ADD CONSTRAINT "stock_notifications_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_notifications" ADD CONSTRAINT "stock_notifications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "wilayas"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_variants" ADD CONSTRAINT "promotion_variants_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_variants" ADD CONSTRAINT "promotion_variants_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_collections" ADD CONSTRAINT "promotion_collections_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_collections" ADD CONSTRAINT "promotion_collections_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_customer_groups" ADD CONSTRAINT "promotion_customer_groups_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_customer_groups" ADD CONSTRAINT "promotion_customer_groups_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "customer_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_usages" ADD CONSTRAINT "promo_usages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_schedules" ADD CONSTRAINT "price_schedules_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "wilayas"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_communeId_fkey" FOREIGN KEY ("communeId") REFERENCES "communes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_pickupPointId_fkey" FOREIGN KEY ("pickupPointId") REFERENCES "pickup_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communes" ADD CONSTRAINT "communes_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "wilayas"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "wilayas"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_credentials" ADD CONSTRAINT "courier_credentials_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_points" ADD CONSTRAINT "pickup_points_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_points" ADD CONSTRAINT "pickup_points_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "wilayas"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_points" ADD CONSTRAINT "pickup_points_communeId_fkey" FOREIGN KEY ("communeId") REFERENCES "communes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "wilayas"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_runs" ADD CONSTRAINT "delivery_runs_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_runs" ADD CONSTRAINT "delivery_runs_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_run_stops" ADD CONSTRAINT "delivery_run_stops_runId_fkey" FOREIGN KEY ("runId") REFERENCES "delivery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_run_stops" ADD CONSTRAINT "delivery_run_stops_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_settlements" ADD CONSTRAINT "courier_settlements_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_settlement_lines" ADD CONSTRAINT "courier_settlement_lines_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "courier_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_settlement_lines" ADD CONSTRAINT "courier_settlement_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_heroMediaId_fkey" FOREIGN KEY ("heroMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_sections" ADD CONSTRAINT "home_sections_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_sections" ADD CONSTRAINT "home_sections_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_sections" ADD CONSTRAINT "home_sections_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abandoned_carts" ADD CONSTRAINT "abandoned_carts_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abandoned_carts" ADD CONSTRAINT "abandoned_carts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
