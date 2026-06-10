import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(),
  },
}));

import { validateConfig, TrmmConfig } from '../utils/config';

function makeConfig(overrides: Partial<TrmmConfig> = {}): TrmmConfig {
  return {
    apiUrl: 'https://rmm.example.com',
    apiKey: 'key123',
    syncFolder: '/sync',
    autoPush: false,
    paranoidMode: false,
    gitSync: true,
    enableScripts: true,
    enableReports: true,
    enablePull: true,
    enablePush: true,
    conflictStrategy: 'ask',
    defaultShell: 'powershell',
    staleStrategy: 'skip',
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
