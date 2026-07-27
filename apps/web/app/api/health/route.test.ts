import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('web health route', () => {
  it('reports the foundation service', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok', service: 'web' });
  });
});
