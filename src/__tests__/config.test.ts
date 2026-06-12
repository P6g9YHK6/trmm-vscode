import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(),
  },
  window: {
    showErrorMessage: vi.fn().mockResolvedValue(undefined),
  },
  commands: {
    executeCommand: vi.fn(),
  },
}));

import * as vscode from 'vscode';
import { validateConfig, showConfigError, TrmmConfig } from '../utils/config';

function makeConfig(overrides: Partial<TrmmConfig> = {}): TrmmConfig {
  return {
    apiUrl: 'https://rmm.example.com',
    apiKey: 'key123',
    syncFolder: '/sync',
    autoPush: false,
    paranoidMode: false,
    enableScripts: true,
    enableReports: true,
    enablePull: true,
    enablePush: true,
    enableGitHistory: false,
    conflictStrategy: 'ask',
    defaultShell: 'powershell',
    staleStrategy: 'skip',
    stripMetadata: true,
    verboseLogging: false,
    ...overrides,
  };
}

describe('validateConfig', () => {
  it('returns null for valid config', () => {
    expect(validateConfig(makeConfig())).toBeNull();
  });

  it('returns error for empty apiUrl', () => {
    const err = validateConfig(makeConfig({ apiUrl: '' }));
    expect(err).toContain('apiUrl');
  });

  it('returns error for empty apiKey', () => {
    const err = validateConfig(makeConfig({ apiKey: '' }));
    expect(err).toContain('apiKey');
  });

  it('returns error for empty syncFolder', () => {
    const err = validateConfig(makeConfig({ syncFolder: '' }));
    expect(err).toContain('syncFolder');
  });

  it('returns error for apiUrl without http(s) scheme', () => {
    const err = validateConfig(makeConfig({ apiUrl: 'rmm.example.com' }));
    expect(err).toContain('http');
  });

  it('returns error for apiUrl with ftp scheme', () => {
    const err = validateConfig(makeConfig({ apiUrl: 'ftp://rmm.example.com' }));
    expect(err).toContain('http');
  });

  it('accepts http:// apiUrl', () => {
    expect(validateConfig(makeConfig({ apiUrl: 'http://rmm.example.com' }))).toBeNull();
  });

  it('accepts https:// apiUrl', () => {
    expect(validateConfig(makeConfig({ apiUrl: 'https://rmm.example.com' }))).toBeNull();
  });

  it('reports first missing field only', () => {
    const err = validateConfig(makeConfig({ apiUrl: '', apiKey: '', syncFolder: '' }));
    expect(err).toContain('apiUrl');
    expect(err).not.toContain('apiKey');
  });
});

describe('showConfigError', () => {
  it('shows error message with Open Settings link', async () => {
    const showErrorMessage = vi.mocked(vscode.window.showErrorMessage);

    await showConfigError('trmm.apiUrl is not configured');

    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    const [msg] = showErrorMessage.mock.calls[0];
    expect(msg).toContain('trmm.apiUrl is not configured');
    expect(msg).toContain('Open Settings');
    expect(msg).toContain('command:');
  });

  it('links to settings filtered to the missing setting', async () => {
    const showErrorMessage = vi.mocked(vscode.window.showErrorMessage);

    await showConfigError('trmm.apiKey is not configured');

    const calls = showErrorMessage.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const msg = calls[calls.length - 1][0] as string;
    expect(msg).toContain('Open Settings');
    expect(msg).toContain('%40ext%3AP6g9YHK6');
    expect(msg).toContain('apiKey');
  });
});
