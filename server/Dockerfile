# syntax=docker/dockerfile:1
FROM node:26-alpine

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

RUN apk add --no-cache su-exec

COPY src ./src
COPY public ./public
COPY web ./web
COPY docker-entrypoint.sh /usr/local/bin/

# Code stays owned by root and read-only for the app. The entrypoint makes /data (and BACKUP_DIR)
# writable, then drops to the unprivileged "node" user.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
