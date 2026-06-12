import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
      update: vi.fn(),
    })),
  },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  commands: {
    executeCommand: vi.fn(),
  },
}));

describe('setupWizard', () => {
  it('exports showSetupWizard function', async () => {
    const mod = await import('../wizard');
    expect(typeof mod.showSetupWizard).toBe('function');
  });
});
