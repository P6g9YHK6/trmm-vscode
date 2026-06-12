import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn() })),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(() => true) })) },
  commands: { executeCommand: vi.fn() },
  languages: { registerDocumentLinkProvider: vi.fn() },
  extensions: { getExtension: vi.fn() },
  Uri: { file: vi.fn() },
}));

describe('ConsoleLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('appendLine logs to console', async () => {
    const { ConsoleLogger } = await import('../logger');
    new ConsoleLogger().appendLine('hello');
    expect(console.log).toHaveBeenCalledWith('hello');
  });

  it('verbose logs with prefix', async () => {
    const { ConsoleLogger } = await import('../logger');
    new ConsoleLogger().verbose('detail');
    expect(console.log).toHaveBeenCalledWith('[verbose]', 'detail');
  });

  it('show is a no-op', async () => {
    const { ConsoleLogger } = await import('../logger');
    expect(() => new ConsoleLogger().show()).not.toThrow();
  });
});

describe('toErrorMessage', () => {
  it('returns Error.message for Error instances', async () => {
    const { toErrorMessage } = await import('../logger');
    expect(toErrorMessage(new Error('broken'))).toBe('broken');
  });

  it('returns string directly', async () => {
    const { toErrorMessage } = await import('../logger');
    expect(toErrorMessage('just a string')).toBe('just a string');
  });

  it('stringifies objects', async () => {
    const { toErrorMessage } = await import('../logger');
    expect(toErrorMessage({ code: 500 })).toContain('500');
  });

  it('handles null gracefully', async () => {
    const { toErrorMessage } = await import('../logger');
    expect(typeof toErrorMessage(null)).toBe('string');
  });
});
