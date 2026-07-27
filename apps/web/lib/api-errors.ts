import { AuthBoundaryError } from '@racio/auth';

export function apiError(error: unknown) {
  if (error instanceof AuthBoundaryError) {
    const status =
      error.code === 'UNAUTHENTICATED'
        ? 401
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'CONFLICT'
            ? 409
            : 400;
    return Response.json(
      { error: { code: error.code, message: 'The request could not be completed.' } },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  console.error(
    JSON.stringify({ component: 'racio-api', event: 'request_failed', error: 'internal' }),
  );
  return Response.json(
    { error: { code: 'INTERNAL', message: 'The request could not be completed.' } },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
