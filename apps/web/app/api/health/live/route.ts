import { readAppEnv } from '@racio/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness: the process is running. No dependencies are touched. */
export function GET() {
  return Response.json(
    { status: 'ok', service: 'web', version: readAppEnv().version },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
