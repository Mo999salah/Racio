# Production worker image: non-root. The worker runs the TypeScript sources
# through tsx (a devDependency) because the monorepo uses bundler module
# resolution; the image installs the full dependency set at the pinned
# lockfile. Runtime is driven entirely by pg-boss queues in PostgreSQL.

FROM node:24-alpine
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV NODE_ENV=production
ARG RACIO_VERSION=0.0.0-dev
ENV RACIO_VERSION=$RACIO_VERSION
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile
COPY apps/worker apps/worker
RUN addgroup -S racio && adduser -S racio -G racio \
  && chown -R racio:racio /app /opt/corepack
USER racio
CMD ["pnpm", "--filter", "@racio/worker", "exec", "tsx", "src/main.ts"]
