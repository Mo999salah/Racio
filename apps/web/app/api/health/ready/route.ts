import { readAppEnv } from '@racio/config';
import { checkDatabaseReadiness } from '@racio/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Readiness: required dependencies are usable.
 *
 * - PostgreSQL answers a trivial query.
 * - The migration chain has been applied (the `drizzle.__drizzle_migrations`
 *   journal holds exactly the expected number of migrations).
 *
 * Optional services (AI providers, OAuth providers, the parser) are never
 * required for readiness.
 */
export async function GET() {
  const env = readAppEnv();
  const checks = await checkDatabaseReadiness(env.DATABASE_URL);
  const ready =
    checks.database &&
    checks.migrations !== null &&
    checks.migrations.applied === checks.migrations.expected;
  return Response.json(
    {
      status: ready ? 'ok' : 'unavailable',
      service: 'web',
      version: env.version,
      checks,
    },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
