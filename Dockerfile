FROM node:24-bookworm-slim
ENV NODE_ENV=production TAXI_AI_MODE=staging PORT=3000 TAXI_AI_BIND=0.0.0.0
WORKDIR /app
RUN mkdir -p /data /backups && chmod 700 /data /backups && chown node:node /data /backups /app
COPY --chown=node:node package.json ./
COPY --chown=node:node apps/web ./apps/web
COPY --chown=node:node apps/admin ./apps/admin
COPY --chown=node:node packages/shared ./packages/shared
COPY --chown=node:node services/api ./services/api
COPY --chown=node:node scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "--experimental-sqlite", "apps/web/server.mjs"]
