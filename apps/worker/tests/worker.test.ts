import { describe, expect, it, vi } from 'vitest';
import { createWorker } from '../src/main';

describe('worker lifecycle', () => {
  it('starts and shuts down the lifecycle wrapper', async () => {
    const boss = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      work: vi.fn(),
    };
    const worker = createWorker(boss);
    await worker.start();
    await worker.shutdown();
    expect(boss.start).toHaveBeenCalledOnce();
    expect(boss.stop).toHaveBeenCalledOnce();
    expect(boss.work).not.toHaveBeenCalled();
  });
});
