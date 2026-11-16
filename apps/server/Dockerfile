FROM node:24-bookworm-slim AS build
RUN npm install --global pnpm@12.4.2
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @yeongdu/server build \
    && pnpm --filter @yeongdu/server deploy --prod /output

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/memo.db
WORKDIR /app
COPY --from=build --chown=node:node /output/ ./
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
