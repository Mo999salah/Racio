import { describe, expect, it } from 'vitest';

import { assertSameOrigin } from './request-security';

describe('assertSameOrigin', () => {
  it('allows requests without an Origin header', () => {
    expect(() => assertSameOrigin(new Request('http://internal:3000/api/imports'))).not.toThrow();
  });

  it('uses the public Host header when the internal request URL differs', () => {
    const request = new Request('http://internal:3000/api/imports', {
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://127.0.0.1:3001',
      },
    });

    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it('uses the forwarded protocol for TLS-terminating proxies', () => {
    const request = new Request('http://internal:3000/api/imports', {
      headers: {
        host: 'finance.example',
        origin: 'https://finance.example',
        'x-forwarded-proto': 'https',
      },
    });

    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it('rejects a different origin', () => {
    const request = new Request('http://internal:3000/api/imports', {
      headers: {
        host: 'finance.example',
        origin: 'https://attacker.example',
        'x-forwarded-proto': 'https',
      },
    });

    expect(() => assertSameOrigin(request)).toThrow('Cross-origin mutation rejected.');
  });

  it('rejects a malformed Origin header with the stable validation error', () => {
    const request = new Request('http://internal:3000/api/imports', {
      headers: {
        host: 'finance.example',
        origin: 'not a URL',
      },
    });

    expect(() => assertSameOrigin(request)).toThrow('Cross-origin mutation rejected.');
  });
});
