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

# Scanner runs as a second process in this same container -- api reaches it over
# 127.0.0.1:3100, never exposed outside the container. Neither process is exec'd into
# this script's own PID -- both stay ordinary backgrounded children, with THIS script
# remaining PID 1 the whole time. That's deliberate, not an oversight: confirmed by
# direct testing that a container's PID 1 is specially protected by the Linux kernel from
# signals sent by another process in the SAME PID namespace, even SIGKILL sent directly
# to PID 1 by number -- only a *voluntary* exit of PID 1 itself reliably tears the
# container down. So instead of trying to signal a sibling into dying, this script polls
# both children and exits itself the moment either one does, which Docker/Render then
# treats as the container exiting and restarts it, bringing both processes back up
# together.
cleanup() {
  echo "Shutting down..."
  kill -9 "$SCANNER_PID" "$API_PID" 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

echo "Starting scanner..."
(cd ../scanner && PORT=3100 npm start) &
SCANNER_PID=$!

echo "Starting server..."
npm start &
API_PID=$!

# `wait -n` (wait for whichever job finishes first) is a bash-ism not available in this
# image's /bin/sh (dash) -- a portable poll works the same way here since both processes
# are meant to run indefinitely, so a 1s check interval costs nothing in practice.
while kill -0 "$SCANNER_PID" 2>/dev/null && kill -0 "$API_PID" 2>/dev/null; do
  sleep 1
done

echo "One of api/scanner exited unexpectedly -- stopping the container so both restart together."
kill -9 "$SCANNER_PID" "$API_PID" 2>/dev/null || true
exit 1
