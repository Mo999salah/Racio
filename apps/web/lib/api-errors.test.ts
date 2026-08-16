import { describe, expect, it } from 'vitest';
import { AuthBoundaryError } from '@racio/auth';
import { apiError } from './api-errors';

async function statusOf(error: unknown): Promise<number> {
  const response = apiError(error);
  return response.status;
}

async function codeOf(error: unknown): Promise<string | null> {
  const response = apiError(error);
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? null;
}

describe('api error mapping for exports', () => {
  it('maps export states to stable HTTP codes', async () => {
    expect(await statusOf(new AuthBoundaryError('EXPORT_EXPIRED', 'expired'))).toBe(410);
    expect(await statusOf(new AuthBoundaryError('EXPORT_NOT_READY', 'preparing'))).toBe(400);
    expect(await statusOf(new AuthBoundaryError('EXPORT_FAILED', 'failed'))).toBe(400);
    expect(await statusOf(new AuthBoundaryError('EXPORT_TOO_MANY_ROWS', 'rows'))).toBe(400);
    expect(await statusOf(new AuthBoundaryError('EXPORT_BUSY', 'busy'))).toBe(400);
    expect(await statusOf(new AuthBoundaryError('EXPORT_STORAGE_ERROR', 'storage'))).toBe(400);
    expect(await statusOf(new AuthBoundaryError('NOT_FOUND', 'missing'))).toBe(404);
    expect(await statusOf(new AuthBoundaryError('UNAUTHENTICATED', 'no session'))).toBe(401);
  });

  it('keeps stable error codes and never leaks internals', async () => {
    expect(await codeOf(new AuthBoundaryError('EXPORT_EXPIRED', 'expired'))).toBe('EXPORT_EXPIRED');
    const internal = apiError(new Error('disk path C:\\secrets'));
    expect(internal.status).toBe(500);
    expect(await codeOf(new Error('boom'))).toBe('INTERNAL');
  });
});
