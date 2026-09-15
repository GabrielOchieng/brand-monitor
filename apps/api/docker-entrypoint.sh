#!/bin/sh
set -e

# Both steps are safe to re-run on every container start (not just the first deploy):
# `migrate deploy` only applies pending migrations, and bootstrapQueue.ts's GRANT
# statements are all idempotent -- this makes `docker compose up -d` alone sufficient
# after every deploy, schema change included, with no separate manual step to remember.
echo "Running database migrations..."
npx prisma migrate deploy

# The migration above always creates brandmonitor_app with its own hardcoded dev password
# (a schema migration can't read env vars at apply time) -- without this, the app fails to
# authenticate against its own database right after the very first deploy, using whatever
# real password DATABASE_APP_URL actually specifies.
echo "Syncing brandmonitor_app's password with DATABASE_APP_URL..."
npm run db:sync-app-role-password

echo "Bootstrapping pg-boss queue schema grants..."
npm run queue:bootstrap

echo "Starting server..."
exec npm start
