-- Our own auth replaces Clerk (2026-11). Credentials, sessions and one-time tokens live in
-- tables with no tenant column: they are read before any org context exists, so they get no
-- RLS. Instead the restricted app role gets no access at all -- only src/auth/* touches them,
-- through adminPrisma (the migration role).

CREATE TABLE "user_auth" (
    "user_id" TEXT NOT NULL,
    "password_hash" TEXT,
    "password_changed_at" TIMESTAMP(3),
    "email_verified_at" TIMESTAMP(3),
    "totp_secret_enc" TEXT,
    "totp_enabled_at" TIMESTAMP(3),
    "totp_last_step" BIGINT,
    "recovery_code_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "google_sub" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_auth_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "active_org_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT,
    "organization_id" TEXT,
    "role" TEXT,
    "new_email" TEXT,
    "data" JSONB,
    "created_by" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_auth_google_sub_key" ON "user_auth"("google_sub");
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");
CREATE INDEX "auth_tokens_purpose_organization_id_idx" ON "auth_tokens"("purpose", "organization_id");
CREATE INDEX "auth_tokens_purpose_user_id_idx" ON "auth_tokens"("purpose", "user_id");

ALTER TABLE "user_auth" ADD CONSTRAINT "user_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The default privileges from 20260910000000_multi_tenancy_rls granted these to the app role.
REVOKE ALL ON "user_auth", "sessions", "auth_tokens" FROM brandmonitor_app;

-- Emails are matched case-insensitively from now on and stored lowercased.
UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email");
