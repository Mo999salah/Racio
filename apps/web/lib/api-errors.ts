import { AiError } from '@racio/ai';
import { AuthBoundaryError } from '@racio/auth';

export function apiError(error: unknown) {
  if (error instanceof AiError) {
    return Response.json(
      { error: { code: error.code, message: 'The AI advisor could not complete the request.' } },
      { status: error.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (error instanceof AuthBoundaryError) {
    const parserCode = error.code.startsWith('XLSX_') || error.code.startsWith('PDF_');
    const status =
      error.code === 'UNAUTHENTICATED'
        ? 401
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'CONFLICT'
            ? 409
            : error.code === 'EXPORT_EXPIRED'
              ? 410
              : error.code === 'XLSX_ARCHIVE_LIMIT_EXCEEDED' ||
                  error.code === 'PDF_UPLOAD_LIMIT_EXCEEDED'
                ? 413
                : parserCode
                  ? 415
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
