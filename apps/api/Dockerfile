# Full bookworm, not -slim -- needed for `playwright install --with-deps` to install
# Chromium's OS-level dependencies cleanly (matches apps/scanner/Dockerfile's existing
# base for the same reason). This image now runs BOTH apps/api and apps/scanner as two
# processes in one container: Render's free tier only gives one always-on service's worth
# of free hours (750/month workspace-wide), not enough for two separate always-on
# services (~1460 combined) -- see docker-entrypoint.sh for how both get started.
FROM node:22-bookworm

# Prisma's engine needs to detect the actual OpenSSL version at generate time -- confirmed
# real on the -slim base image (silently guessed wrong, a risk of failing to load at
# runtime); full bookworm ships it already, but installing explicitly costs nothing and
# doesn't depend on that assumption staying true.
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Monorepo-aware build: apps/api depends on packages/shared via plain npm workspace
# linking ("@brand-monitor/shared": "*", not a registry version), so `npm ci` has to run
# from the repo root against the root lockfile. `npm ci` also validates the lockfile
# against every workspace's package.json, so all four need to be present even though only
# api/scanner/shared's *source* is copied in below -- apps/web's own dependencies get
# installed too (wasted disk, harmless) rather than fighting npm ci over a partial
# workspace graph. This same npm ci already installs apps/scanner's dependencies
# (playwright, etc.) since it's the same lockfile.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/scanner/package.json apps/scanner/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/scanner apps/scanner

# Runs inside this same Linux image, not copied in from a host build -- schema.prisma has
# no binaryTargets override (default "native"), so the generated client's engine binary
# only matches whatever platform generated it.
RUN npm run prisma:generate -w @brand-monitor/api

# Force HTTPS apt sources: on some networks a transparent proxy rewrites/corrupts plain
# HTTP package downloads (observed as widespread apt Hash Sum mismatches on this network,
# consistent with the corporate VPN already in play) -- HTTPS can't be tampered with the
# same way. Same fix apps/scanner/Dockerfile already carries; needed here now too since
# the Playwright install moved into this image. Handles both the classic sources.list and
# Debian's newer deb822 .sources format.
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list 2>/dev/null; \
    sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list.d/*.sources 2>/dev/null; \
    true

# Chromium only -- no firefox/webkit anywhere in this codebase, confirmed via a repo-wide
# grep, so no reason to carry their weight into the image.
RUN npx playwright install --with-deps chromium

WORKDIR /app/apps/api
# The executable bit doesn't survive a Windows dev machine's git checkout/COPY reliably --
# set it explicitly rather than depending on the file's mode in version control.
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 4000

ENTRYPOINT ["./docker-entrypoint.sh"]
