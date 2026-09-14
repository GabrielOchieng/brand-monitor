FROM node:22-bookworm-slim

# Prisma's engine needs to detect the actual OpenSSL version at generate time -- the slim
# base image doesn't have it installed at all, so Prisma silently guessed "openssl-1.1.x"
# (visible as a warning during the build) instead of matching bookworm's real OpenSSL 3.x.
# A guessed-wrong engine binary is a real risk of failing to load at runtime, not just a
# cosmetic warning.
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Monorepo-aware build: apps/api depends on packages/shared via plain npm workspace
# linking ("@brand-monitor/shared": "*", not a registry version), so `npm ci` has to run
# from the repo root against the root lockfile -- installing apps/api in isolation (the
# way apps/scanner's Dockerfile does, since scanner has no such dependency) can't resolve
# it. `npm ci` also validates the lockfile against every workspace's package.json, so all
# four need to be present even though only api/shared's *source* is copied in below --
# apps/web and apps/scanner's own dependencies get installed too (wasted disk, harmless)
# rather than fighting npm ci over a partial workspace graph.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/scanner/package.json apps/scanner/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY packages/shared packages/shared
COPY apps/api apps/api

# Runs inside this same Linux image, not copied in from a host build -- schema.prisma has
# no binaryTargets override (default "native"), so the generated client's engine binary
# only matches whatever platform generated it.
RUN npm run prisma:generate -w @brand-monitor/api

WORKDIR /app/apps/api
# The executable bit doesn't survive a Windows dev machine's git checkout/COPY reliably --
# set it explicitly rather than depending on the file's mode in version control.
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 4000

ENTRYPOINT ["./docker-entrypoint.sh"]
