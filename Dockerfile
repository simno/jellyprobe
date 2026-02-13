FROM node:25-alpine

# Install sqlite and su-exec for dropping privileges at runtime
RUN apk add --no-cache sqlite su-exec

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY src ./src
COPY public ./public

# Create data directory and set a sane ownership at build time. It may be overridden by a bind mount at runtime.
RUN mkdir -p /data && chown -R node:node /data

# Copy entrypoint script which will ensure /data is writable and then drop privileges to node
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production
ENV DATA_PATH=/data

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
