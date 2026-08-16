import { AuthBoundaryError } from '@racio/auth';

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return;

  const requestUrl = new URL(request.url);
  const host = request.headers.get('host')?.trim() || requestUrl.host;
  const forwardedProtocol = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const protocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);

  let expectedOrigin: string;
  let providedOrigin: string;
  try {
    expectedOrigin = new URL(`${protocol}://${host}`).origin;
    providedOrigin = new URL(origin).origin;
  } catch {
    throw new AuthBoundaryError('VALIDATION', 'Cross-origin mutation rejected.');
  }

  if (providedOrigin !== expectedOrigin) {
    throw new AuthBoundaryError('VALIDATION', 'Cross-origin mutation rejected.');
  }
}
