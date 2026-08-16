# One-shot migration image. Runs `drizzle-kit migrate` against the configured
# DATABASE_URL. `NODE_ENV` is intentionally unset so dev dependencies
# (drizzle-kit) are installed; the migration runner never starts the app.

FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages packages
RUN pnpm install --frozen-lockfile
CMD ["pnpm", "--filter", "@racio/database", "db:migrate"]
