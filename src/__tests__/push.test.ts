import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => ({}));

describe('push', () => {
  it('module exports registerPushCommand', async () => {
    const mod = await import('../commands/push');
    expect(mod.registerPushCommand).toBeDefined();
    expect(typeof mod.registerPushCommand).toBe('function');
  });

  it('module exports registerPushFileCommand', async () => {
    const mod = await import('../commands/push');
    expect(mod.registerPushFileCommand).toBeDefined();
    expect(typeof mod.registerPushFileCommand).toBe('function');
  });
});
