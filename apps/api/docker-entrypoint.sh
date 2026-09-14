#!/bin/sh
set -e

# Both steps are safe to re-run on every container start (not just the first deploy):
# `migrate deploy` only applies pending migrations, and bootstrapQueue.ts's GRANT
# statements are all idempotent -- this makes `docker compose up -d` alone sufficient
# after every deploy, schema change included, with no separate manual step to remember.
echo "Running database migrations..."
npx prisma migrate deploy

echo "Bootstrapping pg-boss queue schema grants..."
npm run queue:bootstrap

echo "Starting server..."
exec npm start
