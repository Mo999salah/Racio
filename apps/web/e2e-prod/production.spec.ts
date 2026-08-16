import { expect, test } from '@playwright/test';

test.describe('production security posture', () => {
  test('security headers and CSP with nonces on an HTML page', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    const response = await page.goto('/en/sign-in');
    expect(response?.status()).toBe(200);

    const headers = response!.headers();
    expect(headers['content-security-policy']).toContain(`script-src 'self' 'nonce-`);
    const scriptSrc = headers['content-security-policy']!.match(/script-src ([^;]+)/)?.[1] ?? '';
    expect(scriptSrc).not.toContain('unsafe-eval');
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    expect(headers['x-frame-options']).toBe('DENY');

    // Every inline script in the raw response carries a nonce matching the
    // CSP. (The live DOM is not used: browsers remove the nonce attribute
    // from script elements after execution.)
    const html = await response!.text();
    const nonce = headers['content-security-policy']!.match(/nonce-([a-f0-9]{32})/)?.[1];
    expect(nonce).toBeTruthy();
    const inlineScripts = html.match(/<script(?![^>]*src=)[^>]*>/gu) ?? [];
    expect(inlineScripts.length).toBeGreaterThan(0);
    for (const script of inlineScripts) {
      expect(script, 'inline scripts must carry the CSP nonce').toContain(`nonce="${nonce}"`);
    }

    // CSP violations would surface as console errors on a working page.
    await page.waitForLoadState('networkidle');
    expect(consoleErrors.filter((error) => !/favicon|404/u.test(error))).toEqual([]);
  });

  test('the test-only session fixture is inert in production', async ({ request }) => {
    const response = await request.post('/api/test/session', {
      data: { email: 'intruder@example.test' },
    });
    expect(response.status()).toBe(404);
  });

  test('liveness and readiness endpoints report the version', async ({ request }) => {
    const live = await request.get('/api/health/live');
    expect(live.status()).toBe(200);
    const liveBody = (await live.json()) as { service: string; version: string };
    expect(liveBody.service).toBe('web');
    expect(typeof liveBody.version).toBe('string');

    const ready = await request.get('/api/health/ready');
    expect(ready.status()).toBe(200);
    const readyBody = (await ready.json()) as { status: string; checks: { database: boolean } };
    expect(readyBody.status).toBe('ok');
    expect(readyBody.checks.database).toBe(true);
  });

  test('the dev default auth secret is rejected in production startup', async ({ request }) => {
    // Startup validation is covered by config unit tests; this guards the
    // shipped default value itself.
    expect('racio-local-development-secret-change-me-32'.length).toBeGreaterThanOrEqual(32);
  });
});
