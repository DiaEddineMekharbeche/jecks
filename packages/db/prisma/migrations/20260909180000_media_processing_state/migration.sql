-- Media processing state — PRD-COMPLETION M1.1.
--
-- `renditions` and `posterKey` already exist from the initial schema, so the gap the
-- plan lists is only the state that tells the library whether a file is still being
-- processed and, if it failed, why.

ALTER TABLE "media"
  ADD COLUMN "processedAt" TIMESTAMP(3),
  ADD COLUMN "processingError" VARCHAR(500),
  ADD COLUMN "originalSizeBytes" INTEGER;

-- Everything uploaded before this migration was processed at seed time.
UPDATE "media" SET "processedAt" = "createdAt" WHERE "renditions" IS NOT NULL;

ALTER TABLE "media_folders"
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
  -- Added with a default so existing rows get a value, then dropped: Prisma manages
  -- this column from the application side and would report the default as drift.
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "media_folders" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE INDEX "media_folderId_createdAt_idx" ON "media"("folderId", "createdAt");
CREATE INDEX "media_processedAt_idx" ON "media"("processedAt");

-- Two folders cannot share a name under the same parent, which is what makes a path
-- unambiguous in the library breadcrumb.
CREATE UNIQUE INDEX "media_folders_parentId_name_key" ON "media_folders"("parentId", "name");
