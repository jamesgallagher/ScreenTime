# Build from the repo root: docker build -f server/Dockerfile .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/schemas/package.json packages/schemas/
COPY packages/engine/package.json packages/engine/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY server/ server/
RUN pnpm --filter "@screentime/server..." build
RUN pnpm --filter @screentime/server deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
