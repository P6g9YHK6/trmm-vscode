import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => ({}));

describe('testOnAgent', () => {
  it('module exports registerTestOnAgentCommand', async () => {
    const mod = await import('../commands/testOnAgent');
    expect(mod.registerTestOnAgentCommand).toBeDefined();
    expect(typeof mod.registerTestOnAgentCommand).toBe('function');
  });
});
