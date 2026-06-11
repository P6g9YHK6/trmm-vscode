import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => ({}));

describe('sync', () => {
  it('module exports registerSyncCommand', async () => {
    const mod = await import('../commands/sync');
    expect(mod.registerSyncCommand).toBeDefined();
    expect(typeof mod.registerSyncCommand).toBe('function');
  });
});
