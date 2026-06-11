import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => ({}));

describe('editMetadata', () => {
  it('module exports registerEditMetadataCommand', async () => {
    const mod = await import('../commands/editMetadata');
    expect(mod.registerEditMetadataCommand).toBeDefined();
    expect(typeof mod.registerEditMetadataCommand).toBe('function');
  });
});
