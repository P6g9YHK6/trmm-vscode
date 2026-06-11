import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => ({}));

describe('newScript', () => {
  it('module exports registerNewScriptCommand', async () => {
    const mod = await import('../commands/newScript');
    expect(mod.registerNewScriptCommand).toBeDefined();
    expect(typeof mod.registerNewScriptCommand).toBe('function');
  });
});
