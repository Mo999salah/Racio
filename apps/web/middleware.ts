import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function cspValue(nonce: string | undefined): string {
  // `style-src 'unsafe-inline'` is required for inline style attributes used
  // by the chart and layout primitives; no `unsafe-eval` and no wildcard
  // sources are used.
  const scriptSrc = nonce ? `'self' 'nonce-${nonce}'` : `'self'`;
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    'upgrade-insecure-requests',
  ].join('; ');
}

function securityHeaders(nonce: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'X-Frame-Options': 'DENY',
  };
  if (process.env.NODE_ENV === 'production') {
    headers['Content-Security-Policy'] = cspValue(nonce);
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains';
  }
  return headers;
}

export default function middleware(request: NextRequest) {
  const isDocumentRequest = !request.nextUrl.pathname.startsWith('/api/');
  if (!isDocumentRequest) return intl(request);

  const nonce = process.env.NODE_ENV === 'production' ? randomNonce() : undefined;
  const response = intl(request);

  // Redirects and rewrites end this hop; the target request renders the page
  // and will run middleware itself.
  if (response.headers.has('location') || response.headers.has('x-middleware-rewrite')) {
    for (const [name, value] of Object.entries(securityHeaders(nonce))) {
      response.headers.set(name, value);
    }
    return response;
  }

  // Next.js 15.5 derives the script nonce from the `content-security-policy`
  // REQUEST header, so the CSP must travel with the request passed to
  // `NextResponse.next({ request })`. The same CSP (and the other security
  // headers) are also set on the response so the browser receives them.
  const requestHeaders = new Headers(request.headers);
  if (nonce) {
    requestHeaders.set('content-security-policy', cspValue(nonce));
  }
  const next = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of response.headers.entries()) {
    if (name.toLowerCase() === 'content-length') continue;
    next.headers.set(name, value);
  }
  for (const [name, value] of Object.entries(securityHeaders(nonce))) {
    next.headers.set(name, value);
  }
  return next;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
