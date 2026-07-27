# Local development

1. Copy `.env.example` to `.env` and start PostgreSQL, either directly or with
   `docker compose up postgres`.
2. Install workspace dependencies with `pnpm install`.
3. Apply the current migrations with
   `pnpm --filter @racio/database db:migrate`.
4. Start the web app with `pnpm --filter @racio/web dev`.
5. Configure a real Google or Apple provider for sign-in, then open the
   localized accounts route, for example `/en/accounts` or `/ar/accounts`.

The Phase 3 smoke flow is to create an institution, create its account with a
masked identifier, edit the account, archive it, show archived accounts, and
restore it. No development user bypass is provided. If PostgreSQL or Docker is
unavailable, unit tests, typechecks, migration generation, and the build can
still run, but database integration and authenticated browser verification are
not complete until the services are available.
