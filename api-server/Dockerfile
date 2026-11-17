# Build context: repository root (`.`) so `shared/types` is available
FROM node:22-alpine AS builder
WORKDIR /workspace

COPY shared ./shared
COPY api-server/package*.json ./api-server/

WORKDIR /workspace/api-server
RUN npm ci

COPY api-server/ ./
RUN npm run typecheck && npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=node:node /workspace/api-server/dist ./dist
COPY --from=builder --chown=node:node /workspace/api-server/node_modules ./node_modules
COPY --from=builder --chown=node:node /workspace/api-server/package.json ./

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.mjs"]
