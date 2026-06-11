/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/config', () => ({
  getConfig: vi.fn(),
}));

vi.mock('vscode', () => ({
  Uri: { file: vi.fn((p: string) => ({ $uri: p })) },
  commands: { executeCommand: vi.fn() },
  window: {
    showQuickPick: vi.fn(),
  },
}));

import { getConfig } from '../utils/config';
import * as vscode from 'vscode';
import * as fs from 'fs';

import { makeConflictResolver } from '../commands/conflictResolver';

describe('makeConflictResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when strategy is not ask', () => {
    (getConfig as any).mockReturnValue({ conflictStrategy: 'api', syncFolder: '/sync' });
    expect(makeConflictResolver()).toBeUndefined();
  });

  it('returns undefined when strategy is local', () => {
    (getConfig as any).mockReturnValue({ conflictStrategy: 'local', syncFolder: '/sync' });
    expect(makeConflictResolver()).toBeUndefined();
  });

  describe('returned resolver function', () => {
    const config = { conflictStrategy: 'ask', syncFolder: '/tmp/sync' };

    beforeEach(() => {
      (getConfig as any).mockReturnValue(config);
    });

    it('shows diff when both contents are provided', async () => {
      (vscode.window.showQuickPick as any).mockResolvedValue({ id: 'api' });

      const resolver = makeConflictResolver()!;
      const result = await resolver('/tmp/sync/scripts/test.ps1', 'pull', 'local content', 'api content');

      expect(result).toBe('api');
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.objectContaining({ $uri: expect.stringContaining('trmm-api-') }),
        expect.objectContaining({ $uri: '/tmp/sync/scripts/test.ps1' }),
        'scripts/test.ps1: API vs Local',
      );

      const tmpFile = (vscode.Uri.file as any).mock.calls[0][0];
      const written = fs.readFileSync(tmpFile, 'utf-8');
      expect(written).toBe('api content');
      fs.unlinkSync(tmpFile);
    });

    it('does not open diff when one content is missing', async () => {
      (vscode.window.showQuickPick as any).mockResolvedValue({ id: 'local' });

      const resolver = makeConflictResolver()!;
      const result = await resolver('/tmp/sync/scripts/test.ps1', 'push', 'local content', undefined);

      expect(result).toBe('local');
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('uses correct direction label for push', async () => {
      (vscode.window.showQuickPick as any).mockResolvedValue({ id: 'api' });

      const resolver = makeConflictResolver()!;
      await resolver('/tmp/sync/scripts/test.ps1', 'push', 'l', 'a');

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ placeHolder: expect.stringContaining('Local changed') }),
      );
    });

    it('uses correct direction label for pull', async () => {
      (vscode.window.showQuickPick as any).mockResolvedValue({ id: 'api' });

      const resolver = makeConflictResolver()!;
      await resolver('/tmp/sync/scripts/test.ps1', 'pull', 'l', 'a');

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ placeHolder: expect.stringContaining('API changed') }),
      );
    });

    it('handles subdirectory paths', async () => {
      (vscode.window.showQuickPick as any).mockResolvedValue({ id: 'api' });

      const resolver = makeConflictResolver()!;
      await resolver('/tmp/sync/scripts/networking/ping.ps1', 'pull', 'l', 'a');

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.objectContaining({ $uri: expect.stringContaining('trmm-api-') }),
        expect.objectContaining({ $uri: '/tmp/sync/scripts/networking/ping.ps1' }),
        'scripts/networking/ping.ps1: API vs Local',
      );
    });

    it('defaults to api when quickpick is cancelled', async () => {
      (vscode.window.showQuickPick as any).mockResolvedValue(undefined);

      const resolver = makeConflictResolver()!;
      const result = await resolver('/tmp/sync/scripts/test.ps1', 'pull', 'l', 'a');

      expect(result).toBe('api');
    });

    it('passes through api-all and local-all options', async () => {
      (vscode.window.showQuickPick as any).mockResolvedValue({ id: 'local-all' });

      const resolver = makeConflictResolver()!;
      const result = await resolver('/tmp/sync/scripts/test.ps1', 'pull', 'l', 'a');

      expect(result).toBe('local-all');
    });
  });
});
