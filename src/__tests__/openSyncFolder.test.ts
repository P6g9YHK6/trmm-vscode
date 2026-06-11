import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => ({}));

describe('openSyncFolder', () => {
  it('module exports registerOpenSyncFolderCommand', async () => {
    const mod = await import('../commands/openSyncFolder');
    expect(mod.registerOpenSyncFolderCommand).toBeDefined();
    expect(typeof mod.registerOpenSyncFolderCommand).toBe('function');
  });
});
