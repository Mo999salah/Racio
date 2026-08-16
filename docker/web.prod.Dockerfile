# Production web image: multi-stage, non-root, minimal runtime.

FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
ARG RACIO_VERSION=0.0.0-dev
ENV RACIO_VERSION=$RACIO_VERSION
COPY apps/web apps/web
COPY DESIGN.md SPEC.md SECURITY.md ./
RUN pnpm --filter @racio/web build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG RACIO_VERSION=0.0.0-dev
ENV RACIO_VERSION=$RACIO_VERSION
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/apps/web/.next apps/web/.next
COPY --from=build /app/apps/web/next.config.mjs apps/web/next.config.mjs
COPY --from=build /app/apps/web/i18n apps/web/i18n
COPY --from=build /app/apps/web/public apps/web/public
COPY --from=build /app/apps/web/package.json apps/web/package.json
RUN addgroup -S racio && adduser -S racio -G racio \
  && chown -R racio:racio /app /opt/corepack
USER racio
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
