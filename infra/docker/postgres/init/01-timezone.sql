-- Storage stays UTC; reporting converts to Africa/Algiers at the edge (PRD Section 3).
-- Postgres extensions are NOT created here: Prisma owns them through
-- `previewFeatures = ["postgresqlExtensions"]`, and creating them out of band shows up
-- as migration drift. See packages/db/prisma/migrations for pg_trgm, unaccent, pgcrypto.
ALTER DATABASE jecks SET timezone TO 'UTC';
