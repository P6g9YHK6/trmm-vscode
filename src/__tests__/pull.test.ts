import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => ({}));

describe('pull', () => {
  it('module exports registerPullCommand', async () => {
    const mod = await import('../commands/pull');
    expect(mod.registerPullCommand).toBeDefined();
    expect(typeof mod.registerPullCommand).toBe('function');
  });
});
