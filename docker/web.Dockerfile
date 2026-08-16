# Development web image: hot-reload via `next dev`. Production deployments
# must use docker/web.prod.Dockerfile (see docker-compose.prod.yml).

FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY DESIGN.md SPEC.md SECURITY.md ./
EXPOSE 3000
CMD ["pnpm", "--filter", "@racio/web", "dev"]
