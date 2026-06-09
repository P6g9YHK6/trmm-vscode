import * as vscode from 'vscode';

export interface TrmmConfig {
  apiUrl: string;
  apiKey: string;
  syncFolder: string;
  autoPush: boolean;
  conflictStrategy: 'ask' | 'local' | 'api';
  defaultShell: string;
}

export function getConfig(): TrmmConfig {
  const cfg = vscode.workspace.getConfiguration('trmm');
  return {
    apiUrl: (cfg.get<string>('apiUrl', '') || '').replace(/\/+$/, ''),
    apiKey: cfg.get<string>('apiKey', ''),
    syncFolder: cfg.get<string>('syncFolder', ''),
    autoPush: cfg.get<boolean>('autoPush', false),
    conflictStrategy: cfg.get<'ask' | 'local' | 'api'>('conflictStrategy', 'ask'),
    defaultShell: cfg.get<string>('defaultShell', 'powershell'),
  };
}

export function validateConfig(config: TrmmConfig): string | null {
  if (!config.apiUrl) return 'trmm.apiUrl is not configured';
  if (!config.apiKey) return 'trmm.apiKey is not configured';
  if (!config.syncFolder) return 'trmm.syncFolder is not configured';
  if (!config.apiUrl.startsWith('http://') && !config.apiUrl.startsWith('https://')) {
    return 'trmm.apiUrl must start with http:// or https://';
  }
  return null;
}
