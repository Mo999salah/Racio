# Development worker image. Production deployments must use
# docker/worker.prod.Dockerfile (see docker-compose.prod.yml).

FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile
COPY apps/worker apps/worker
CMD ["pnpm", "--filter", "@racio/worker", "dev"]
