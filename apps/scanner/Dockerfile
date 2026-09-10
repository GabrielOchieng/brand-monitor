FROM node:22-bookworm

WORKDIR /app

COPY package.json ./
RUN npm install

# Force HTTPS apt sources: on some networks a transparent proxy rewrites/corrupts plain
# HTTP package downloads (observed as widespread apt Hash Sum mismatches on this network,
# consistent with the corporate VPN already in play) -- HTTPS can't be tampered with the
# same way. Handles both the classic sources.list and Debian's newer deb822 .sources format.
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list 2>/dev/null; \
    sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list.d/*.sources 2>/dev/null; \
    true

# Avoids mcr.microsoft.com/playwright entirely (that registry's Azure Traffic-Manager
# CNAME chain resolves fine from the host but is unreliable through Docker Desktop's
# internal DNS forwarder on some networks) -- installs Chromium + its OS deps directly
# on top of the plain Docker-Hub node image instead.
RUN npx playwright install --with-deps chromium

COPY src ./src
COPY tsconfig.json ./

EXPOSE 3100

CMD ["npm", "start"]
