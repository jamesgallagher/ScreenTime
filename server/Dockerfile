# Build from the repo root: docker build -f server/Dockerfile .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/schemas/package.json packages/schemas/
COPY packages/engine/package.json packages/engine/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY server/ server/
COPY web/ web/
RUN pnpm --filter "@screentime/server..." --filter "@screentime/web..." build
RUN pnpm --filter @screentime/server deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
# The server also serves the parent web app from here (docs/SPEC.md §4.2).
ENV WEB_DIR=/app/public
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/web/dist ./public
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
