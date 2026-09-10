-- M1.4 — settings, users, roles, audit and backups.
--
-- Jobs gain a result column so the screens that trigger work (a backup, later a report
-- export) can report what it produced without a second table per job type.
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "result" JSONB;

-- The audit log is read by entity and by actor from the admin, and both are already
-- indexed. What is missing is the plain "everything, newest first" the journal opens on.
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs" ("createdAt" DESC);

-- A staff invitation is looked up by its token hash on accept, which is already unique,
-- and listed by recency in the users screen.
CREATE INDEX IF NOT EXISTS "staff_invitations_createdAt_idx" ON "staff_invitations" ("createdAt" DESC);
