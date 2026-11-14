# Same code as the Cloudflare Worker, served by Node (@hono/node-server).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json package-lock.json ./
# tsx runs the TypeScript directly; build-data needs it too (nightly refresh in-container).
RUN npm ci --omit=dev && npm install --no-save tsx@4 && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
COPY content ./content
COPY data ./data
COPY public ./public
COPY tsconfig.json ./
EXPOSE 8787
USER node
HEALTHCHECK --interval=5m --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8787/health || exit 1
CMD ["node_modules/.bin/tsx", "src/node.ts"]
