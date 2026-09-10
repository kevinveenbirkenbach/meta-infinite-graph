FROM node:22-alpine AS vendor

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY scripts/vendor.js scripts/vendor.js
COPY src/role/brands.json src/role/brands.json
RUN node scripts/vendor.js

FROM nginx:alpine

RUN apk add --no-cache git python3

ENV MIG_GIT_PORT=8399 MIG_GIT_KEEP=3

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker_entrypoint/10-mig-github.sh /docker-entrypoint.d/10-mig-github.sh
COPY docker_entrypoint/20-mig-git.sh /docker-entrypoint.d/20-mig-git.sh
COPY mig-git.py /usr/local/bin/mig-git.py
COPY src/ /usr/share/nginx/html/
COPY --from=vendor /build/src/vendor/ /usr/share/nginx/html/vendor/

RUN chmod +x /docker-entrypoint.d/10-mig-github.sh /docker-entrypoint.d/20-mig-git.sh \
 && : > /etc/nginx/mig-github.conf \
 && : > /etc/nginx/mig-git.conf

EXPOSE 80
